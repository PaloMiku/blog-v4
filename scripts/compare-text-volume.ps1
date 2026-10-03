$ErrorActionPreference = 'Stop'

# Global content-volume comparison: how much visible text does each side render?
# This is the headline metric for whether the MDC -> MDX conversion lost content.
#
# NOTE: ASCII-only (Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI).
#
# ============================ THIS IS A REPORT, NOT A GATE ============================
# It always exits 0 and it is deliberately NOT wired into acceptance.ps1. Read this
# before believing a number it prints.
#
# It compares the text of the two **static HTML files**, and on the Nuxt side a
# large share of pages are only an SPA shell: the Nuxt payload for `/` carries
# `serverRendered: false`, so the shell contains the chrome and nothing else,
# and the body arrives from the client. Astro prerenders everything. So "Astro
# renders 430% more text on /" does NOT mean the migration added content -- it
# means `.output/public/index.html` is nearly empty. Same for /archive,
# /games/galgames/clannad, /previews/example.
#
# Measured on 2026-10-02: 68 pages compared, total +24.8%, ZERO pages below
# -2%. Read that as "the static files are not comparable", not as "no content
# was lost".
#
# The question this was meant to answer -- did the MDC -> MDX conversion drop
# content -- is answered by the RENDERED comparison instead
# (`compare-ui-parity.mjs`, which measures both sides in a real browser; its
# per-page node counts and page heights are the signal that actually tracks
# content drift). Keep this script for eyeballing the static files.
#
# Path note: both sides are resolved from the script's own location, so the
# result does not depend on the current directory (`Resolve-Path` with a
# relative path follows the process CWD, not the script -- findings 85.6).
# The Nuxt side is the FROZEN baseline (baseline/nuxt), not a live build: the
# Nuxt source tree is gone, so `pnpm generate` no longer exists as a source.

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$base = (Resolve-Path (Join-Path $here '..\baseline\nuxt')).Path
$dist = (Resolve-Path (Join-Path $here '..\dist')).Path

function Get-Text([string]$html) {
	$t = $html
	$t = $t -replace '(?s)<script.*?</script>', ' '
	$t = $t -replace '(?s)<style.*?</style>', ' '
	$t = $t -replace '(?s)<svg.*?</svg>', ' '
	$t = $t -replace '(?s)<head.*?</head>', ' '
	$t = $t -replace '<[^>]+>', ' '
	$t = $t -replace '&nbsp;', ' '
	$t = $t -replace '&amp;', '&'
	$t = $t -replace '&lt;', '<'
	$t = $t -replace '&gt;', '>'
	$t = $t -replace '&quot;', '"'
	$t = $t -replace '&#\d+;', ' '
	return ($t -replace '\s+', ' ').Trim()
}

$rows = @()
Get-ChildItem $base -Recurse -File -Filter *.html | ForEach-Object {
	$rel = $_.FullName.Substring($base.Length).Replace('\', '/')
	$rel = $rel -replace '/index\.html$', '/'
	# Astro emits directories with index.html; rebuild the concrete file path
	$ab = if ($rel.EndsWith('/')) { Join-Path $dist ($rel.TrimStart('/') + 'index.html') } else { Join-Path $dist $rel.TrimStart('/') }
	if (-not (Test-Path -LiteralPath $ab -PathType Leaf)) { return }
	if ($rel -eq '/probe/') { return }

	$nt = (Get-Text ([System.IO.File]::ReadAllText($_.FullName))).Length
	$at = (Get-Text ([System.IO.File]::ReadAllText($ab))).Length
	$rows += [PSCustomObject]@{
		Page = $rel; Nuxt = $nt; Astro = $at
		Pct = if ($nt -gt 0) { [math]::Round((($at - $nt) / $nt) * 100, 1) } else { 0 }
	}
}

$rows = $rows | Sort-Object Pct
"pages compared : $($rows.Count)"
$sumN = ($rows | Measure-Object Nuxt -Sum).Sum
$sumA = ($rows | Measure-Object Astro -Sum).Sum
"total chars    : nuxt=$sumN  astro=$sumA  delta=$(($sumA - $sumN)) ($([math]::Round((($sumA-$sumN)/$sumN)*100,1))%)"
''
'--- pages where Astro renders LESS than Nuxt (potential conversion loss) ---'
$loss = @($rows | Where-Object { $_.Pct -lt -2 })
if ($loss.Count -eq 0) { '  none' } else { $loss | ForEach-Object { "  {0,7:N1}%  {1}" -f $_.Pct, $_.Page } }
''
'--- biggest Astro GAINS (Nuxt was dropping content) ---'
$rows | Select-Object -Last 8 | ForEach-Object { "  {0,7:N1}%  {1}  (nuxt={2} astro={3})" -f $_.Pct, $_.Page, $_.Nuxt, $_.Astro }
''
'--- pages within +-2% (parity) ---'
"  $(@($rows | Where-Object { $_.Pct -ge -2 -and $_.Pct -le 2 }).Count) of $($rows.Count)"
