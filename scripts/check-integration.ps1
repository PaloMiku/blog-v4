$ErrorActionPreference = 'Stop'

# Phase 4 integration gate: verify the interactive layer is actually wired,
# not merely present in source. Astro silently skips unreferenced components,
# so every marker here is checked in the BUILT artifact.

$dist = (Resolve-Path '.\dist').Path
$page = Join-Path $dist '2025/11/riddle-joker/index.html'
if (-not (Test-Path $page)) { 'SKIP: page not built'; exit 1 }
$html = [System.IO.File]::ReadAllText($page)

# Astro code-splits <script> blocks into separate chunks, so client logic must be
# searched in the emitted JS as well -- checking only inline <script> reports
# false negatives for every component that got its own chunk.
$jsAll = ((Get-ChildItem (Join-Path $dist '_astro') -Filter *.js | ForEach-Object {
	[System.IO.File]::ReadAllText($_.FullName)
}) -join "`n")

$cssAll = ((Get-ChildItem (Join-Path $dist '_astro') -Filter *.css | ForEach-Object {
	[System.IO.File]::ReadAllText($_.FullName)
}) -join "`n")

$all = $html + $jsAll

function Has([string]$hay, [string]$needle) { return $hay.Contains($needle) }

$checks = [ordered]@{
	# modal stack wiring
	'modal host mounted'      = (Has $html 'data-modal-host')
	'modal scrim present'     = (Has $html 'data-modal-scrim')
	'search modal registered' = (Has $html 'data-modal="search"')
	'lightbox registered'     = (Has $html 'data-modal="lightbox"')
	'lightbox trigger script' = (Has $all 'openModal')
	# The share feature was removed on both sides (Nuxt + Astro).
	# These three assertions are inverted rather than deleted on purpose: once the
	# structure is gone, the only way it can silently come back is someone
	# reintroducing those markers, and no positive assertion here would go red.
	# Scan $all (HTML + JS chunks), not just $html: the trigger markup and the modal
	# root are in the HTML, the init code is in a client chunk.
	'share fully removed'     = (-not ($all -match 'data-share|data-modal="share"|blog-share|shareReady|share-(card|qr|menu|item|icon)'))
	# Button.astro data-* regression (trap: undeclared props are dropped)
	'button primary class'    = (Has $html 'z-button button primary')
	# image zoom intent
	'pic zoom hook'           = (Has $html 'data-zoom-caption')
	# article features
	'AI excerpt'              = (Has $html 'ai-excerpt')
	'excerpt content id'      = (Has $html 'excerpt-content')
	'twikoo container'        = (Has $html 'id="twikoo"')
	'twikoo init call'        = (Has $all 'envId')
	# layout shell
	'blog-root'               = (Has $html 'id="blog-root"')
	'main content'            = (Has $html 'id="main-content"')
	# css regressions
	'no invalid :hover>&'     = (-not ($cssAll -match '\[[^\]]+\]:hover>&'))
	'no double-scoped article'= (-not ($cssAll -match 'article\[data-astro-cid-[^\]]+\]\s*\.'))
}

$pass = 0
$fail = 0
foreach ($k in $checks.Keys) {
	if ($checks[$k]) { "  OK    $k"; $pass++ }
	else { "  FAIL  $k"; $fail++ }
}

''
"PASS: $pass  FAIL: $fail"
if ($fail -eq 0) {
	'RESULT: PASS - phase 4 integration intact'
	exit 0
}
"RESULT: FAIL - $fail issue(s)"
# acceptance.ps1 runs every gate as a `powershell -File` child and takes
# $LASTEXITCODE as the verdict. Printing RESULT: FAIL is not enough: without an
# explicit non-zero exit the child returns 0 and the gate can never fail a run.
# (Observed: this file printed RESULT: FAIL while $LASTEXITCODE was still 0.)
exit 1
