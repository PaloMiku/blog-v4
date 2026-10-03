$ErrorActionPreference = 'Stop'

# Anchor-class parity gate.
#
# Failure mode this exists for (found by screenshot review, missed by every other gate):
#   styles/article.css is ONE top-level `.article { ... }` block holding every prose
#   rule (line-height, headings, lists, blockquote, and `img { max-width: 100% }`).
#   The Astro page template emitted `<article class="md-story">` and dropped the
#   static `article` class, so the whole stylesheet matched nothing on every article
#   page: unstyled prose plus images overflowing the column.
#
#   Every structural gate still passed, because they check that text/titles/urls/dates
#   survive -- never that the CSS still has a selector to attach to.
#
# So: compare the class attribute of the <article> open tag, Astro vs Nuxt, page by
# page. A dropped or renamed anchor class shows up here as a set difference.
#
# NOTE: ASCII-only (Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI).
#
# Every path below is resolved from $PSScriptRoot, never from the process CWD.
# A relative path handed to Resolve-Path follows the CWD, so the same script
# silently reads a different directory depending on who launched it -- that is
# exactly how check-dates and compare-urls ended up pointing at paths that have
# never existed (docs/astro-phase1-findings.md 85.6).

$siteRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dist = Join-Path $siteRoot 'dist'
$baseline = Resolve-Path (Join-Path $siteRoot 'baseline\nuxt') -ErrorAction SilentlyContinue
if (-not $baseline) { 'FAIL: frozen Nuxt baseline missing. Run: pnpm generate, then node scripts/freeze-baseline.mjs'; exit 1 }
$baseline = $baseline.Path

function Get-PageMap($root) {
	$map = @{}
	foreach ($f in Get-ChildItem $root -Recurse -Filter *.html -File) {
		$rel = $f.FullName.Substring($root.Length + 1) -replace '\\', '/'
		$map[$rel] = $f.FullName
	}
	return $map
}

# Pull the class list off the FIRST <article ...> open tag, if there is one.
function Get-ArticleClasses($path) {
	$h = [System.IO.File]::ReadAllText($path)
	$m = [regex]::Match($h, '<article\b[^>]*>')
	if (-not $m.Success) { return $null }
	$c = [regex]::Match($m.Value, 'class="([^"]*)"')
	if (-not $c.Success) { return @() }
	return @($c.Groups[1].Value -split '\s+' | Where-Object { $_ } | Sort-Object)
}

$astroPages = Get-PageMap $dist
$nuxtPages = Get-PageMap $baseline

'--- 1. pages carrying an <article> must keep the Nuxt anchor class set ---'
$fail = 0
$checked = 0
$noArticle = 0
foreach ($rel in ($astroPages.Keys | Sort-Object)) {
	if (-not $nuxtPages.ContainsKey($rel)) { continue }

	$a = Get-ArticleClasses $astroPages[$rel]
	$n = Get-ArticleClasses $nuxtPages[$rel]

	if ($null -eq $a -and $null -eq $n) { $noArticle++; continue }

	if ($null -eq $n) {
		# Astro invented an <article> the baseline has no counterpart for.
		"ASTR-ONLY  $rel  astro=[$(($a -join ' '))]"
		continue
	}

	$checked++
	$missing = @($n | Where-Object { $a -notcontains $_ })
	$extra = @($a | Where-Object { $n -notcontains $_ })
	if ($missing.Count -eq 0 -and $extra.Count -eq 0) { continue }

	$fail++
	"DIFF       $rel"
	"             nuxt : $($n -join ' ')"
	"             astro: $($a -join ' ')"
	if ($missing.Count) { "             MISSING vs nuxt: $($missing -join ' ')" }
	if ($extra.Count) { "             EXTRA   vs nuxt: $($extra -join ' ')" }
}

"  compared pages with <article> : $checked"
"  pages without <article>       : $noArticle"
if ($checked -gt 0) { "  OK    all <article> class sets match the baseline" } else { '  MISS  no page with <article> was compared'; $fail++ }

'--- 2. the `article` anchor class must exist in the emitted CSS ---'
# If this rule is absent from the bundle, article.css was dropped from the build
# entirely -- a different failure with the same symptom.
$cssFiles = Get-ChildItem (Join-Path $dist '_astro') -Filter *.css -ErrorAction SilentlyContinue
$cssAll = (($cssFiles | ForEach-Object { [System.IO.File]::ReadAllText($_.FullName) }) -join "`n")
if ($cssAll -match '\.article\b') {
	'  OK    .article rule present in dist/_astro css'
}
else {
	'  MISS  .article rule absent from every css bundle'
	$fail++
}

'--- 3. img max-width guard survives (the overflow symptom) ---'
if ($cssAll -match 'max-width:\s*100%') {
	'  OK    max-width:100% present in css'
}
else {
	'  MISS  no max-width:100% anywhere in css'
	$fail++
}

''
if ($fail -eq 0) { "RESULT: PASS - anchor classes match the Nuxt baseline ($checked pages)"; exit 0 }
"RESULT: FAIL - $fail problem(s) found"
exit 1
