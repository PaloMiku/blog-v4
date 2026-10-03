$ErrorActionPreference = 'Stop'

# Layout gate: verify the Astro build reproduces the three-column blog shell.
# The layout is driven by app/layouts/default.vue in the Nuxt project, whose grid
# depends on exact ids/classes AND a :has() selector to collapse to two columns.
# Getting any of them wrong still builds fine but silently breaks the layout.
#
# NOTE: ASCII-only (Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI).

$dist = (Resolve-Path '.\dist').Path
$html = Join-Path $dist '2025/11/riddle-joker/index.html'
if (-not (Test-Path -LiteralPath $html)) { "SKIP: page not built"; exit 1 }

$page = [System.IO.File]::ReadAllText($html)

'--- 1. structural ids/classes ---'
$required = @(
	'id="blog-root"',
	'id="main-content"',
	'id="blog-sidebar"',
	'id="blog-aside"',
	'class="blog-aside-track"',
	'class="blog-footer'
)
$fail = 0
foreach ($r in $required) {
	$n = ([regex]::Matches($page, [regex]::Escape($r))).Count
	if ($n -ge 1) { "  OK    $r (x$n)" } else { "  MISS  $r"; $fail++ }
}

'--- 2. global CSS tokens present ---'
$cssFiles = Get-ChildItem (Join-Path $dist '_astro') -Filter *.css -ErrorAction SilentlyContinue
$cssAll = ($cssFiles | ForEach-Object { [System.IO.File]::ReadAllText($_.FullName) }) -join "`n"
if (-not $cssFiles) { "  MISS  no css emitted at all"; $fail++ }
else {
	"  OK    $((Get-ChildItem (Join-Path $dist '_astro') -File | Measure-Object).Count) files under dist/_astro"
	foreach ($tok in @('--c-primary', '--c-text-1', '--c-border', '--ld-bg-card', '--box-shadow-2')) {
		if ($cssAll -match [regex]::Escape($tok)) { "  OK    token $tok" } else { "  MISS  token $tok"; $fail++ }
	}
}

'--- 3. three-column grid + responsive collapse ---'
# The :has() selector is what drops the aside column; it must survive compilation.
if ($cssAll -match ':has\(') { '  OK    :has() selector survived' } else { '  MISS  :has() selector absent (aside column will never collapse)'; $fail++ }
foreach ($bp in @('1080px', '768px')) {
	if ($cssAll -match [regex]::Escape($bp)) { "  OK    breakpoint $bp" } else { "  MISS  breakpoint $bp"; $fail++ }
}

'--- 4. scope-trap regression: article & must not be double-scoped ---'
# Vue emits: article .x[data-v-a]      (scope on & only)
# Broken Astro form: article[data-astro-cid-x] .x[...]  -> never matches
$broken = [regex]::Matches($cssAll, 'article\[data-astro-cid-[^\]]+\]\s*\.')
if ($broken.Count -eq 0) { '  OK    no double-scoped article ancestor selector' } else { "  FAIL  $($broken.Count) double-scoped article selectors"; $fail++ }

'--- 4b. invalid nesting regression: `:hover > &` must be flattened ---'
# Astro does not flatten CSS nesting the way postcss-nesting does. A source rule
# like `.x { :hover > & {} }` is emitted verbatim as `[cid]:hover>&`, which is
# invalid CSS and is silently dropped by every browser.
$invalidNesting = [regex]::Matches($cssAll, '\[[^\]]+\]:hover>&')
if ($invalidNesting.Count -eq 0) { '  OK    no un-flattened hover-ampersand selectors' } else { "  FAIL  $($invalidNesting.Count) un-flattened selectors"; $fail++ }
# sanity: the Quote hover rule must still exist in flattened form
if ($cssAll -match ':hover>\.icon-line\[') { '  OK    Quote hover rule present in flattened form' } else { '  MISS  Quote hover rule missing'; $fail++ }

'--- 5. inlined head scripts (color-mode / anti-mirror) ---'
$inline = [regex]::Matches($page, '(?s)<script(?![^>]*\bsrc=)[^>]*>')
"  OK    $(([regex]::Matches($page, '(?s)<script(?![^>]*\bsrc=)[^>]*>')).Count) inline script blocks"
$preload = [regex]::Matches($page, '<link[^>]+rel="modulepreload"').Count
"  modulepreload links: $preload   (Nuxt baseline had 87 assets / 1561.9 KB)"

''
if ($fail -eq 0) { 'RESULT: PASS - layout shell intact' } else { "RESULT: FAIL - $fail issue(s)" }
