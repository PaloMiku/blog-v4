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

# Known per-(page, marker) deltas, keyed "page|marker" -> reason.
#
# Every one of the 15 mismatches this gate reports is "Astro renders >= Nuxt",
# and all of them have been traced to a source. They are listed here rather than
# silently tolerated, so a NEW divergence still fails the run -- and so the next
# reader can tell a port defect from a parser difference at a glance.
#
# Two root causes cover all of them:
#
#   (1) Nuxt Content's MDC parser does not do what the source says, Astro's MDX
#       pipeline does. Concretely: a named slot written `#tab2` (no leading
#       space) plus a following fenced block, `<Folding>` inside a container
#       block, and GFM tables at that nesting depth. The live site is the one
#       that loses content; the source and the Astro build agree with each other.
#       Verified against the source, not assumed: `clannad/index.mdx` has 17
#       `<Folding>` and 508 table rows, and Astro renders exactly 17 and 31
#       tables. Policy is the 2026-10-02 decision: keep Astro's correct render,
#       do not replicate the parser defect.
#   (2) Pages that were deliberately rewritten as Astro MDX (previews/example,
#       the theme & components doc pages per findings section 84).
#
# The deltas that DO move are in a different instrument: page height
# (compare-ui-parity.mjs), where these pages measure d=-10px -- the share button
# difference every article page has -- because `<details>` bodies and unselected
# tab panels are collapsed, contributing 0px. So "Astro renders more DOM" and
# "the page is the same height" are both true here, and that is the point.
$knownMarkers = @{
	'2025/10/nukitashi-gv-end|tab-button' = 'root cause (1): the page uses MDC named slots (#tab1/#tab2); Nuxt builds no tab buttons, Astro emits them'
	'2025/10/nukitashi-gv-end|blur'       = 'root cause (1): Blur is inside a named slot, so Nuxt drops it'
	'2025/10/nukitashi-gv-end|badge'      = 'root cause (1): Badges inside named slots; Nuxt renders 5 of 8'
	'2025/10/nukitashi-gv-end|pre-code'   = 'root cause (1): the fenced block in the #tab slot is swallowed by Nuxt'
	'drive|tab-button'                    = 'root cause (1): drive.mdx uses <Tab tabs={[...]}>, Nuxt builds no tab buttons'
	'drive|badge'                         = 'root cause (1): 3 of the 8 <Badge> in drive.mdx sit in the `## 主维护者` section inside <div slot="tab2">; Nuxt does not render that slot. Source 8, Astro 8, Nuxt 5.'
	'link|tab-button'                     = 'root cause (1): the friend-link instructions tab'
	'link|pre-code'                       = 'root cause (1): the instructions code block on the link page; Nuxt renders none. Same item as the $knownDelta entry in check-dead-css.ps1.'
	'about|tab-button'                    = 'root cause (1): same, on the about page'
	'games/galgames/clannad|tab-button'   = 'root cause (1): 5 Tab blocks in the source, 15 tab buttons in Astro'
	'games/galgames/clannad|folding'      = 'root cause (1): source has 17 <Folding>; Nuxt renders 3. Astro matches the source.'
	'games/galgames/clannad|card-list'    = 'root cause (1): the card list sits inside a container block'
	'games/galgames/clannad|table'        = 'root cause (1): source has 508 table rows / Astro renders 31 tables; Nuxt renders 0'
	'previews/example|tab-button'         = 'root cause (2): page rewritten as Astro MDX in findings section 84'
	'previews/example|folding'            = 'root cause (2): same'
	'previews/example|link-card'          = 'root cause (2): same'
	'previews/example|pre-code'           = 'root cause (2): same -- the page IS the MDX syntax documentation'
}

$totalMismatch = 0
$totalKnown = 0
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
	$knownHere = @()
	foreach ($k in $markers.Keys) {
		$m = $markers[$k]
		$nc = ([regex]::Matches($nh, [regex]::Escape($m))).Count
		$ac = ([regex]::Matches($ah, [regex]::Escape($m))).Count
		if ($nc -eq $ac) { continue }
		$key = "$rel|$k"
		if ($knownMarkers.ContainsKey($key)) {
			$knownHere += ("         {0}: nuxt={1} astro={2}" -f $k, $nc, $ac)
			$knownHere += ("           KNOWN  {0}" -f $knownMarkers[$key])
			$totalKnown++
			continue
		}
		$diffs += ("{0}: nuxt={1} astro={2}" -f $k, $nc, $ac)
	}
	if ($diffs.Count -eq 0 -and $knownHere.Count -eq 0) {
		"  OK   $rel  (all $($markers.Count) markers match)"
	}
	elseif ($diffs.Count -eq 0) {
		"  KNOWN $rel  ($($knownHere.Count / 2) marker(s), all explained)"
		$knownHere | ForEach-Object { $_ }
	}
	else {
		"  DIFF $rel"
		$diffs | ForEach-Object { "         $_" }
		if ($knownHere.Count -gt 0) { $knownHere | ForEach-Object { $_ } }
		$totalMismatch += $diffs.Count
	}
}
''
"MARKER MISMATCHES TOTAL: $totalMismatch  (explained and listed: $totalKnown)"
if ($totalMismatch -gt 0) {
	''
	'RESULT: FAIL - a marker diverges with no recorded reason.'
	'        Either port the missing structure, or add it to $knownMarkers with a'
	'        reason. Do NOT raise the tolerance.'
	exit 1
}
''
'RESULT: PASS - every marker either matches or has a recorded root cause'
exit 0
