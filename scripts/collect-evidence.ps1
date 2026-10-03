$ErrorActionPreference = 'Stop'

# Independent evidence collection for the migration completion claim.
# Each check prints its own method + result so the claim is auditable.
#
# NOTE: ASCII-only. Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI; non-ASCII
# bytes in a comment get mangled and can swallow the following newline, silently
# breaking later lines (docs/astro-phase1-findings.md 85.7). This file used to
# carry Chinese section headers; they are English now for that reason.
#
# NOTE: every path resolves from $PSScriptRoot, never from the process CWD
# (findings 85.6). The Nuxt side is the FROZEN baseline in baseline/nuxt --
# the Nuxt source tree is gone, so `pnpm generate` no longer exists.

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$base = Join-Path $root 'baseline/nuxt'
$dist = Join-Path $root 'dist'
$srcStyles = Join-Path $root 'src/styles'
$scripts = $PSScriptRoot

function Sha([string]$p) { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash }

'=== 0. CI triggers (YAML parsed as a structure, not grepped as text) ==='
$ciOut = & node (Join-Path $scripts 'check-ci-triggers.mjs') 2>&1
"  exit: $LASTEXITCODE"
$ciOut | Where-Object { $_ -match 'OK:|problem|deployers|push' } | Select-Object -First 4 | ForEach-Object { '  ' + $_.Trim() }

''
'=== 1. CSS: source inventory + baseline-vs-dist bundle size ==='
# The original compared Nuxt's app/assets/css/*.css against src/styles/*.css by
# SHA-256. That is no longer possible: the Nuxt source tree was deleted when Astro
# took over the repo root. What remains checkable is the shipped CSS, baseline
# bundle vs dist bundle. Rule-level equality is covered by check-anchor-classes.ps1
# and by compare-ui-parity.mjs --styles; do not re-derive it here.
$srcCssFiles = Get-ChildItem $srcStyles -File -Filter *.css
"  src/styles  : $($srcCssFiles.Count) css files / $([math]::Round((($srcCssFiles | Measure-Object Length -Sum).Sum/1KB),1)) KB"
$baseCss = Get-ChildItem (Join-Path $base '_nuxt') -File -Filter *.css -ErrorAction SilentlyContinue
$distCss = Get-ChildItem (Join-Path $dist '_astro') -File -Filter *.css -ErrorAction SilentlyContinue
"  baseline css: $($baseCss.Count) files / $([math]::Round((($baseCss | Measure-Object Length -Sum).Sum/1KB),1)) KB  (nuxt _nuxt/)"
"  dist css    : $($distCss.Count) files / $([math]::Round((($distCss | Measure-Object Length -Sum).Sum/1KB),1)) KB  (astro _astro/)"

''
'=== 2. favicon stub, byte for byte ==='
$fa = Join-Path $base 'favicon.ico/index.html'
$fb = Join-Path $dist 'favicon.ico/index.html'
"  nuxt  : $((Get-Item $fa).Length) B  $(Sha $fa)"
"  astro : $((Get-Item $fb).Length) B  $(Sha $fb)"
"  IDENTICAL: $((Sha $fa) -eq (Sha $fb))"

''
'=== 3. feed endpoints (dist only -- see the note) ==='
# This section used to diff atom.xml / subscriptions.oppl against the Nuxt product
# byte for byte, after stripping the build timestamps. That comparison is gone:
# scripts/freeze-baseline.mjs collects only *.html and *.css, so the Nuxt XML was
# never frozen. The omission was a mistake in that script's rationale (it argued
# "no gate reads the baseline's JS" and did not check XML), and it cannot be
# repaired locally any more -- the Nuxt source tree is deleted, so
# `pnpm generate` no longer exists to re-freeze from. *.xml is now in the freeze
# whitelist for the future; recovering this specific pair means fetching
# https://blog.sotkg.com/atom.xml (or restoring the pre-2026-10-03 .output/public
# from a machine that still had the Nuxt tree).
foreach ($n in @('atom.xml', 'subscriptions.opml')) {
	$p = Join-Path $dist $n
	if (-not (Test-Path $p)) { "  $n : MISSING from dist"; continue }
	$body = [System.IO.File]::ReadAllText($p)
	$count = ($body -split "`r?`n").Count
	if ($body.EndsWith("`n")) { $count-- }
	$entries = ([regex]::Matches($body, '<entry>')).Count
	$items = ([regex]::Matches($body, '<outline')).Count
	"  $n : $((Get-Item $p).Length) B, $count lines, <entry>=$entries, <outline=$items"
}

''
'=== 4. main branch and the frozen baseline ==='
$mainHead = (git -C $root log --oneline -1 main)
"  main HEAD: $mainHead"
$bf = Get-ChildItem $base -Recurse -File
"  baseline   : $($bf.Count) files / $([math]::Round((($bf | Measure-Object Length -Sum).Sum/1MB),2)) MB"
$freezeMeta = Join-Path $base 'BASELINE.md'
if (Test-Path $freezeMeta) { "  frozen from: $((Get-Content $freezeMeta | Select-String '来源提交').Line -replace '.*`([^`]+)`.*','$1')" }

''
'=== 5. date offsets, every page (not a sample) ==='
$dateOut = & (Join-Path $scripts 'check-dates.ps1')
$dateOut | Select-Object -Last 12 | ForEach-Object { '  ' + $_ }

''
'=== 6. per-article JS+CSS actually loaded ==='
$pg = Join-Path $dist '2025/11/riddle-joker/index.html'
$h = [System.IO.File]::ReadAllText($pg)
$assets = [regex]::Matches($h, '(?:src|href)="(/_astro/[^"]+\.(?:js|css))"') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
$sum = 0
foreach ($x in $assets) {
	$p = Join-Path $dist $x.TrimStart('/')
	if (Test-Path -LiteralPath $p) { $sum += (Get-Item -LiteralPath $p).Length }
}
"  assets=$($assets.Count)  total=$([math]::Round($sum/1KB,1)) KB  (nuxt baseline was 87 / 1561.9 KB)"

''
'=== 7. dist inventory ==='
$af = Get-ChildItem $dist -Recurse -File
"  dist: $($af.Count) files / $([math]::Round((($af | Measure-Object Length -Sum).Sum/1MB),2)) MB"
foreach ($p in @('index.html', 'atom.xml', 'subscriptions.opml', 'llms.txt', 'sitemap-index.xml', 'search-index.json', 'robots.txt')) {
	"    $p : $(if (Test-Path (Join-Path $dist $p)) { 'ok' } else { 'MISSING' })"
}
"    raw/*.md : $((Get-ChildItem (Join-Path $dist 'raw') -Recurse -File -ErrorAction SilentlyContinue).Count) (nuxt baseline had 63)"
