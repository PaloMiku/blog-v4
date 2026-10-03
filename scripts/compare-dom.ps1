$ErrorActionPreference = 'Stop'

# DOM-level parity check between the Nuxt baseline and the Astro build.
# Counts structural markers per content page. This is the Phase 2 acceptance gate:
# MDC -> MDX conversion must not lose or duplicate rendered structure.
#
# NOTE: ASCII-only, per the Windows PowerShell 5.1 ANSI code page issue.
# Paths resolve from $PSScriptRoot, not the process CWD (findings 85.6).

$siteRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$base = (Resolve-Path (Join-Path $siteRoot 'baseline\nuxt')).Path
$dist = Join-Path $siteRoot 'dist'

# Structural markers chosen to cover: block components, inline components,
# code blocks, math, lists/tables, and the wrappers Astro introduces differently.
#
# Markers MUST anchor on root elements. A loose prefix like 'class="link-card'
# also matches child classes (link-card-info / -title / -description), so the
# count then depends on how many children each card has rather than card count.
# Every marker below is a full, unambiguous root-element signature.
$markers = [ordered]@{
	'tab-panel'      = 'class="tab-content"'
	'tab-button'     = 'data-tab-select='
	'alert'          = 'class="alert"'
	'folding'        = '<details'
	'card-list'      = 'class="card-list"'
	'quote'          = 'class="quote title-like"'
	'blur'           = 'class="blur"'
	'badge'          = 'class="badge '
	'link-card'      = 'class="link-card card"'
	'link-banner'    = 'class="link-banner card"'
	'poetry'         = 'class="poetry'
	'video'          = 'class="video"'
	'music'          = 'class="music-embed'
	'chat'           = '<dl class="chat"'
	'timeline'       = '<dl class="timeline"'
	'series-group'   = 'class="series-group'
	'project-group'  = 'class="project-group'
	'resource-list'  = 'class="resource-list'
	'katex'          = 'class="katex"'
	'pre-code'       = '<pre'
	'table'          = '<table'
}

$pages = @(
	'2025/11/riddle-joker', '2025/05/gal-up', '2024/08/docker-deploy-outline',
	'2025/10/nukitashi-gv-end', 'drive', 'link', 'about',
	'games/galgames/aokana', 'games/galgames/clannad', 'previews/example'
)

$totalMismatch = 0
foreach ($rel in $pages) {
	$nb = Join-Path $base "$rel/index.html"
	$ab = Join-Path $dist "$rel/index.html"
	if (-not (Test-Path -LiteralPath $nb) -or -not (Test-Path -LiteralPath $ab)) {
		"  SKIP $rel (missing on one side)"
		continue
	}
	$nh = [System.IO.File]::ReadAllText($nb)
	$ah = [System.IO.File]::ReadAllText($ab)

	$diffs = @()
	foreach ($k in $markers.Keys) {
		$m = $markers[$k]
		$nc = ([regex]::Matches($nh, [regex]::Escape($m))).Count
		$ac = ([regex]::Matches($ah, [regex]::Escape($m))).Count
		if ($nc -ne $ac) { $diffs += ("{0}: nuxt={1} astro={2}" -f $k, $nc, $ac) }
	}
	if ($diffs.Count -eq 0) {
		"  OK   $rel  (all $($markers.Count) markers match)"
	}
	else {
		"  DIFF $rel"
		$diffs | ForEach-Object { "         $_" }
		$totalMismatch += $diffs.Count
	}
}
''
"MARKER MISMATCHES TOTAL: $totalMismatch"
