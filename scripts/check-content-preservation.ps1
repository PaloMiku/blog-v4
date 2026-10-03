$ErrorActionPreference = 'Stop'

# Content-preservation gate: sample prose lines from the SOURCE and check that
# they survive into the rendered HTML.
#
# The source is `src/content/**.mdx` -- the glob loader's real input, and since
# the takeover the ONLY content source. It used to sample the Nuxt `content/*.md`
# and walk to the codemod'd `.mdx` for the page path; with the Nuxt tree deleted
# that pairing no longer exists, and sampling a source that is not what the build
# reads is how this gate ended up reporting a "missing paragraph" on a page whose
# real text is all present.
#
# NOTE: ASCII-only (Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI).
# NOTE: paths resolve from $PSScriptRoot, not the process CWD (findings 85.6).

$siteRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$mdxRoot = Join-Path $siteRoot 'src/content'
$dist = Join-Path $siteRoot 'dist'

function Normalize-Text([string]$t) {
	$t = $t -replace '&nbsp;', ' '
	$t = $t -replace '&amp;', '&'
	$t = $t -replace '&lt;', '<'
	$t = $t -replace '&gt;', '>'
	$t = $t -replace '&quot;', '"'
	return $t
}

# Reduce a rendered page to a flat bag of visible text.
#
# Needed because an inline code span, a component or an icon inside a sentence
# splits the rendered markup: `foo` in the source becomes "foo <code>bar</code> baz"
# in the HTML, and a link that has no icon in the source becomes
# "text<svg .../>  ，next" in the output. A contiguous needle taken from the source
# line will then never match even though the prose is fully present.
#
# All whitespace is removed on BOTH sides. That is deliberate: whitespace around
# inserted markup is a rendering artefact, not content, and keeping it produced
# two false "missing paragraph" reports on /drive/ and /games/galgames/nukitashi/
# whose text is verifiably present in dist. What this gate is for is "did a chunk
# of prose survive the pipeline", and character continuity answers that without
# tripping over typography.
function Get-VisibleText([string]$html) {
	$t = $html
	$t = $t -replace '(?s)<script.*?</script>', ' '
	$t = $t -replace '(?s)<style.*?</style>', ' '
	# Icons carry no text; drop the element entirely rather than substituting a
	# space, otherwise a decorative svg between two words invents a space that the
	# source never had.
	$t = $t -replace '(?s)<svg.*?</svg>', ''
	$t = $t -replace '<[^>]+>', ''
	$t = Normalize-Text $t
	$t = $t -replace '\s+', ''
	return $t.Trim()
}

$totalChecked = 0
$totalMissing = 0
$report = @()

Get-ChildItem $mdxRoot -Recurse -File -Filter *.mdx | ForEach-Object {
	$mrel = $_.FullName.Substring($mdxRoot.Length).Replace('\', '/')

	$pageRel = $mrel -replace '\.mdx$', '/'
	$pageRel = $pageRel -replace '(^|/)index$', '$1'
	$htmlFile = Join-Path $dist ($pageRel.TrimStart('/') + 'index.html')
	if (-not (Test-Path -LiteralPath $htmlFile -PathType Leaf)) { return }

	$visible = Get-VisibleText ([System.IO.File]::ReadAllText($htmlFile))
	$lines = [System.IO.File]::ReadAllLines($_.FullName)

	# Track the two "this is not prose" regions: frontmatter and fenced code.
	# Sampling either produces false positives -- they are consumed by the parser,
	# not rendered.
	$inFence = $false
	$inFrontmatter = $false
	$checked = 0
	$missing = @()
	# Deterministic sampling, and note the direction: a LARGER divisor means FEWER
	# samples (every 10th line < every 40th line). 63 content files at /40 sampled
	# only 71 lines site-wide, which is ~1 line per file -- too thin to catch a
	# dropped paragraph. /10 raises that without introducing false positives,
	# because the needle is whitespace-insensitive and strips inline JSX.
	$sampleEvery = [Math]::Max(1, [Math]::Floor($lines.Count / 10))

	for ($i = 0; $i -lt $lines.Count; $i++) {
		$l = $lines[$i]
		$t = $l.Trim()

		# frontmatter: the --- fence right after line 0
		if ($i -eq 0 -and $t -eq '---') { $inFrontmatter = $true; continue }
		if ($inFrontmatter) { if ($t -eq '---') { $inFrontmatter = $false }; continue }

		if ($t -match '^\s*```') { $inFence = -not $inFence; continue }
		if ($inFence) { continue }

		if ($t -eq '' -or $t.StartsWith('#')) { continue }
		# JSX: the codemod emitted components, slots and wrapper divs. Their
		# attribute lines are markup, not prose, and a stray `items={...}` reads
		# as a lost paragraph if it is sampled.
		if ($t.StartsWith('<')) { continue }
		if ($t -match '^(import|export)\s') { continue }
		# MDC YAML attribute block: a --- fence between a directive and its close
		if ($t -eq '---') { continue }
		if ($t -match '^\|') { continue }
		if ($t -match '^[-*+>]\s') { continue }

		# strip inline markdown so the needle matches rendered text
		$t = $t -replace '^[-*+>]\s*', ''
		$t = $t -replace '!\[([^\]]*)\]\([^)]*\)', '$1'
		$t = $t -replace '\[([^\]]*)\]\([^)]*\)', '$1'
		# inline JSX components: `<Blur>text</Blur>`, `<Badge ... />`.
		# The rendered page has the text but never the tag, so the tag must come
		# out of the needle. Only a line that *starts* with `<` was skipped above;
		# a component in the middle of a sentence reaches here.
		$t = $t -replace '</?[A-Z][A-Za-z0-9]*(\s[^>]*?)?/?>', ''
		$t = $t -replace ':[a-zA-Z][a-zA-Z0-9-]*\[([^\]]*)\](\{[^}]*\})?', '$1'
		$t = $t -replace '\*\*|`|__|\*', ''
		if ($t.Length -lt 20) { continue }
		# skip lines that are mostly a URL (link definitions, bare images)
		if (([regex]::Matches($t, 'https?://')).Count -gt 0 -and $t.Length -lt 40) { continue }
		# deterministic sampling so runs are comparable. 40 -> 20: the needle is now
		# whitespace-insensitive and strips inline JSX, so the false-positive rate
		# dropped to zero and the old divisor was sampling only 71 lines site-wide
		# (63 files). More samples for the same cost.
		if (($i % $sampleEvery) -ne 0) { continue }

		$checked++
		# both sides are whitespace-free (see Get-VisibleText), so a rendered page
		# that merely reformats punctuation still matches
		$needle = ($t -replace '\s+', '')
		$needle = $needle.Substring(0, [Math]::Min(24, $needle.Length))
		if ($visible -notmatch [regex]::Escape($needle)) {
			$missing += "L$($i + 1): $needle"
		}
	}

	if ($checked -gt 0) {
		$totalChecked += $checked
		$totalMissing += $missing.Count
		$rate = [math]::Round((($checked - $missing.Count) / $checked) * 100, 1)
		if ($missing.Count -gt 0) {
			$report += [PSCustomObject]@{ Page = $pageRel; Checked = $checked; Missing = $missing.Count; Rate = $rate; Samples = $missing }
		}
	}
}

"sampled prose lines checked : $totalChecked"
"missing from dist output    : $totalMissing"

# Guard first. A zero here means the sampler matched nothing -- e.g. the content
# root moved and this script is walking an empty tree. Without the guard the
# script dies inside the rate arithmetic with "Attempted to divide by zero",
# which reports as a crash instead of the verdict it actually is: the gate
# measured nothing, so it cannot pass.
if ($totalChecked -eq 0) {
	''
	'RESULT: FAIL - 0 lines were sampled, so nothing was measured.'
	'        Check that src/content/**/*.mdx exists and that dist/ is a fresh build.'
	exit 1
}

"preservation rate           : $([math]::Round((($totalChecked - $totalMissing) / $totalChecked) * 100, 2))%"
''
if ($report.Count -eq 0) {
	'RESULT: PASS - every sampled prose line survived'
	exit 0
}
"### pages with missing prose ($($report.Count))"
$report | Sort-Object Rate | ForEach-Object {
	"  {0,6:N1}%  {1}  (missing $($_.Missing)/$($_.Checked))" -f $_.Rate, $_.Page
	$_.Samples | Select-Object -First 2 | ForEach-Object { "            $_" }
}
''
'RESULT: FAIL'
exit 1
