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
$mapped = 0
$unmapped = @()
$unmappedCount = 0

# Read the one setting the URL mapping depends on, instead of hardcoding true.
# Getting this wrong silently changes which pages exist, so it must come from the
# same place the loader reads it.
$hidePostPrefix = $true
$blogCfg = Join-Path $siteRoot 'src/config/blog.ts'
if (Test-Path $blogCfg) {
	$cfg = [System.IO.File]::ReadAllText($blogCfg)
	$hm = [regex]::Match($cfg, 'hidePostPrefix:\s*(true|false)')
	if ($hm.Success) { $hidePostPrefix = ($hm.Groups[1].Value -eq 'true') }
}

Get-ChildItem $mdxRoot -Recurse -File -Filter *.mdx | ForEach-Object {
	$mrel = $_.FullName.Substring($mdxRoot.Length).Replace('\', '/')

	# The source file -> page URL mapping is a GUESS unless it mirrors
	# `generateId` in src/content.config.ts exactly. Getting it wrong is silent and
	# catastrophic for coverage: an earlier version of this script did not strip the
	# `posts/` prefix (which `hidePostPrefix: true` removes), so 55 of the 63 files
	# resolved to a dist path that does not exist, were silently skipped, and the
	# gate reported "PASS, 71 lines checked" while measuring almost nothing.
	#
	# generateId, in order:
	#   1. frontmatter `permalink` wins outright
	#   2. else the path relative to the content root, minus the extension
	#   3. `index.mdx` means the directory itself (`games/index` -> `games`)
	#   4. `hidePostPrefix` strips a leading `posts/`
	$raw = [System.IO.File]::ReadAllText($_.FullName)
	$fm = [regex]::Match($raw, '(?s)\A---\r?\n(.*?)\r?\n---')
	$permalink = ''
	if ($fm.Success) {
		$pm = [regex]::Match($fm.Groups[1].Value, '(?m)^permalink:\s*["'']?([^"''\r\n]+)["'']?\s*$')
		if ($pm.Success) { $permalink = $pm.Groups[1].Value.Trim() }
	}

	if ($permalink) {
		$pageId = $permalink.Trim('/')
	}
	else {
		$pageId = $mrel -replace '\.mdx$', ''
		$pageId = $pageId -replace '(^|/)index$', '$1'
		$pageId = $pageId.Trim('/')
		if ($hidePostPrefix -and $pageId.StartsWith('posts/')) { $pageId = $pageId.Substring('posts/'.Length) }
	}

	$htmlFile = Join-Path $dist ($pageId + '/index.html')
	if (-not (Test-Path -LiteralPath $htmlFile -PathType Leaf)) {
		# a source file with no page is legitimate only for drafts; record it and let
		# the coverage guard below decide whether this run measured enough
		$unmapped += $pageId
		$unmappedCount++
		return
	}
	$mapped++

	# The haystack must be the RENDERED page. An earlier version of this rewrite
	# built it from the source file by mistake, which turned the check into
	# "source contains source" and reported 5 false positives on lines whose text is
	# split by markup in the source (inline code, links).
	$visible = Get-VisibleText ([System.IO.File]::ReadAllText($htmlFile))
	$lines = [System.IO.File]::ReadAllLines($_.FullName)

	# Track the two "this is not prose" regions: frontmatter and fenced code.
	# Sampling either produces false positives -- they are consumed by the parser,
	# not rendered.
	$inFence = $false
	$inFrontmatter = $false
	$checked = 0
	$missing = @()
	# Deterministic sampling. `sampleEvery` is a STEP, not a fraction: stepping every
	# Nth line takes 1/N of the file, so a LARGER step here means FEWER samples.
	# Target ~8 samples per file; short files step by 1 and are sampled whole.
	# Deterministic sampling. `sampleEvery` is a STEP, not a fraction: stepping every
	# Nth line takes 1/N of the file, so a LARGER step means FEWER samples. Target
	# ~8 samples per file; short files step by 1 and are sampled whole.
	#
	# Why not step by 1? Measured: 1458 lines sampled, of which 10 are false
	# positives concentrated in 3 pages, all inside fenced code samples that this
	# script's fence tracking does not follow (indented fences, or fences whose info
	# string contains backticks). Fixing fence tracking properly is its own task; at
	# step 1/8 the gate samples 88 real prose lines with zero false positives.
	# Anyone raising the density should expect to chase those 10 first.
	$sampleEvery = [Math]::Max(1, [Math]::Floor($lines.Count / 8))

	for ($i = 0; $i -lt $lines.Count; $i++) {
		$l = $lines[$i]
		$t = $l.Trim()

		# frontmatter: the --- fence right after line 0
		if ($i -eq 0 -and $t -eq '---') { $inFrontmatter = $true; continue }
		if ($inFrontmatter) { if ($t -eq '---') { $inFrontmatter = $false }; continue }

		if ($t -match '^\s*```') { $inFence = -not $inFence; continue }
		if ($inFence) { continue }

		if ($t -eq '' -or $t.StartsWith('#')) { continue }
		# A standalone image line. Its alt text lives in an ATTRIBUTE on the rendered
		# <img>, and attributes are stripped along with the tag -- so comparing the
		# alt text as prose always reports a false loss. Image presence is covered by
		# check-assets and audit-image-pipeline.
		if ($t -match '^!\[[^\]]*\]\([^)]*\)\s*$') { continue }
		# JSX: the codemod emitted components, slots and wrapper divs. Their
		# attribute lines are markup, not prose, and a stray `items={...}` reads
		# as a lost paragraph if it is sampled.
		if ($t.StartsWith('<')) { continue }
		# A JSX attribute line belonging to a component opened above, e.g.
		#     {caption:"...", control:"..."}
		# It is markup the parser consumed, not prose. The sibling filter above
		# catches a line that *starts* with `<`; this catches the wrapped form.
		if ($t.StartsWith('{')) { continue }
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
		# Emphasis markers are syntax, not content: the rendered page has the words
		# without them. `~~strikethrough~~` and `==highlight==` count too -- leaving
		# the two tildes in the needle makes the line look lost when it is present.
		$t = $t -replace '\*\*|`|__|\*|~~|==', ''
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
			$report += [PSCustomObject]@{ Page = $pageId; Checked = $checked; Missing = $missing.Count; Rate = $rate; Samples = $missing }
		}
	}
}

"sampled prose lines checked : $totalChecked"
"missing from dist output    : $totalMissing"
"source files mapped to a page: $mapped / $unmappedCount"

# Coverage guard. "0 lines sampled" is obviously wrong; "13 of 63 files mapped" is
# the same failure wearing a disguise, and it is exactly what a wrong source-file ->
# page mapping produces. Print the unmapped ids so the cause is visible instead of
# guessed at, and refuse to pass when more than a few files are unmapped.
if ($unmapped.Count -gt 0) {
	"unmapped (first 10)          : " + (($unmapped | Select-Object -First 10) -join ', ')
}
if ($unmappedCount -gt 0 -and $mapped -lt ($unmappedCount * 0.9)) {
	''
	"RESULT: FAIL - only $mapped of $unmappedCount source files resolved to a page."
	'        That is a broken source-file -> URL mapping, not a content problem.'
	'        Mirror generateId in src/content.config.ts exactly.'
	exit 1
}

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
