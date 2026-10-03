param(
	# Opt-in extra gate: computed-style parity against the live site.
	#
	# Off by default because it measures the whole site a second time and adds
	# roughly as much wall time as the page-height gate it sits next to.
	# It is worth turning on before a cutover: page height cannot see a dead
	# rule that only sets color / border-radius / box-shadow, and that is
	# precisely the failure mode this migration keeps hitting.
	[switch]$Styles,
	# Opt-in extra gate: repeat the page-height sweep at a phone width.
	#
	# The site carries a lot of `@media (max-width: 768px)` rules, so a desktop
	# sweep that comes back clean says nothing about the narrow layout. Costs
	# one more full sweep; the result lands in its own JSON file.
	[switch]$Mobile,
	# Opt-in extra gate: computed-style parity again, but with the colour scheme
	# forced to dark.
	#
	# Dark mode swaps the whole token set, and page height is blind to colour --
	# so this is the only instrument that can say anything about it. The source
	# was already checked by hand (color.css is byte-identical, the .dark rule
	# sets match, both sides put .dark on <html>); this measures the result.
	[switch]$Dark
)

$ErrorActionPreference = 'Stop'

# Single entry point for accepting an Astro migration change.
#
#   1. install (so a newly declared dependency is actually present)
#   2. build once -- every gate below reads dist/, so ONE build keeps them
#      consistent with each other and with the source tree
#   3. run every static gate
#   4. run the two node gates (CI trigger parity, headless-Chrome interaction)
#   5. print one summary table; exit non-zero if anything failed
#
# Why one build and not one-per-gate: several gates compare Astro output against
# the Nuxt baseline in .output/public. A gate that rebuilds could observe a
# half-written dist and report a phantom diff.
#
# NOTE: ASCII-only. Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI; non-ASCII
# bytes in a comment swallow the following newline and silently skip the next
# statement. See docs/astro-phase1-findings.md.

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$results = New-Object System.Collections.ArrayList

function Step($name, $block) {
	$sw = [System.Diagnostics.Stopwatch]::StartNew()
	# Native commands that write to stderr (pnpm's deprecation notices, node's
	# DEP0190, vite warnings) raise a NON-terminating NativeCommandError under
	# PS 5.1. With the script-wide ErrorActionPreference=Stop that becomes
	# terminating and my catch would report a green build as exit 1. Relax it for
	# the duration of the block and read the real status from $LASTEXITCODE.
	$prev = $ErrorActionPreference
	$ErrorActionPreference = 'Continue'
	try {
		$out = & $block
		$code = $LASTEXITCODE
		if ($null -eq $code) { $code = 0 }
		# `$out` is ONE multi-line string here, because every block ends in
		# `| Out-String`. Piping that straight into Where-Object matches the
		# whole blob, so Select-Object -Last 1 handed the entire gate output
		# back as the summary Note -- Format-Table -Wrap then printed a
		# 30-line cell per row and the summary table stopped being a summary.
		# Match per line instead.
		$lines = @("$out" -split "`r?`n" | Where-Object { $_.Trim() -ne '' })
		$note = ($lines | Where-Object { $_ -match 'RESULT|PASS:|passed|CONCLUSION|HAZARD|Complete!|page\(s\)|ACCEPTED|OK:|FAIL:|self-contained' } | Select-Object -Last 1)
		# Fallback for gates that report in Chinese: the marker regex above is
		# English-only, so check-self-contained was landing in the table with a
		# blank Note. Its last line is the one that carries the count.
		if (-not $note) { $note = ($lines | Select-Object -Last 1) }
		$sw.Stop()
		return [pscustomobject]@{ Step = $name; Exit = $code; Seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1); Note = "$note".Trim() }
	}
	catch {
		$sw.Stop()
		return [pscustomobject]@{ Step = $name; Exit = 1; Seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1); Note = $_.Exception.Message }
	}
	finally {
		$ErrorActionPreference = $prev
	}
}

# -- 1. install ---------------------------------------------------------------
$results.Add((Step 'pnpm install' { & pnpm install 2>&1 | Out-String }))

# -- 2. build -----------------------------------------------------------------
$results.Add((Step 'pnpm build' { & pnpm build 2>&1 | Out-String }))

# -- 3. static gates (read dist/) --------------------------------------------
$gates = @(
	'check-integration',
	'check-layout',
	'check-anchor-classes',
	'check-dead-css',
	'check-assets',
	'compare-urls',
	'compare-titles',
	# Wired 2026-10-03. compare-dom used to be one of the "exists but unwired"
	# scripts (findings 85.4: a gate you do not wire does not exist). It reported 15
	# marker mismatches while exiting 0, which is the "scored but never went red"
	# family (85.5). Both are fixed: it now has a $knownMarkers map with a recorded
	# root cause per (page, marker), and it exits 1 on anything not on that map.
	'compare-dom',
	# Wired 2026-10-03 for the same reason. Evidence-only (it collects, it does not
	# assert), but a non-zero exit means one of the products it reads is missing,
	# which is worth failing a run over.
	'collect-evidence',
	'check-content-preservation',
	'check-dates',
	'audit-deferred',
	'audit-image-pipeline'
)
# NOTE: check-build-warnings is deliberately NOT in this list. See section 4a.

# Known unreachable scoped rules (audit-dead-scope.mjs), each with its reason.
#
# Astro compiles `.x` inside a component's <style> into `.x[data-astro-cid-<that
# component>]`. When the class travels onto a CHILD component
# (`<Icon class="chevron" />`), the element carries the CHILD's cid and the rule
# silently never matches -- Vue has no such problem because a child component's
# root element ALSO gets the parent's scope id. Measured cost of one of these:
# the article cover lost `aspect-ratio:16/9` and rendered 6x too tall.
#
# Fixing one is `:global(...)`, but that widens the selector site-wide, so each
# needs its visual impact checked against the live site first. Until they are
# fixed, pin the count here: it is a ratchet, not a rubber stamp. A NEW dead rule
# fails the run; silently fixing one lowers the bar.
#
# All 3 below are verified NOT to be visual defects, and the judge deliberately
# cannot tell them apart from real ones (it only reports evidence, see
# docs/astro-phase1-findings.md section 52):
#   1. PostFooter `.content`      -- no article has a `references:` frontmatter,
#                                    so the section never renders. Nuxt baseline
#                                    renders zero too. Applying :global() here
#                                    would widen the selector for no gain.
#   2. Collection `.header-text > .title` -- consequence of the deliberate
#                                    post-collection parity gate (see
#                                    pages/[...slug].astro PARITY_HIDE_COLLECTION):
#                                    the component no longer renders, so its CSS
#                                    ships but matches nothing.
#   3. SearchModal `.search-item.active` -- an interactive-only state. The class
#                                    is toggled by the search script at runtime
#                                    (keyboard navigation); the static product can
#                                    never contain it.
$knownDeadScope = 3

# This step does NOT go through Step(): its exit code is derived from the WARN
# count below, not read from the tool. It therefore runs under the script-wide
# ErrorActionPreference=Stop, and PS 5.1 promotes ANY stderr byte from a native
# command into a terminating NativeCommandError. audit-dead-scope writes its
# "new unexplained dead rule" verdict to stderr, so the whole run died HERE with
# an empty RemoteException and never reached the summary table (found 2026-10-03,
# pnpm accept exited 1 after printing no table at all).
# Relax the preference for exactly this call, the same way Step() does.
$deadWatch = [System.Diagnostics.Stopwatch]::StartNew()
$prevDeadPref = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$deadOut = (& node (Join-Path $PSScriptRoot 'audit-dead-scope.mjs') 2>&1 | Out-String)
$ErrorActionPreference = $prevDeadPref
$deadWatch.Stop()
$deadCount = 0
if ($deadOut -match 'WARN:\s*(\d+)\s') { $deadCount = [int]$Matches[1] }
$deadExit = if ($deadCount -gt $knownDeadScope) { 1 } else { 0 }
$results.Add([pscustomobject]@{
	Step    = 'audit-dead-scope'
	Exit    = $deadExit
	Seconds = [math]::Round($deadWatch.Elapsed.TotalSeconds, 1)
	Note    = "scoped dead rules: $deadCount (known baseline $knownDeadScope)"
})

# audit-css-blocks: catches <style> blocks damaged by bulk rewrites.
#
# `content/Tab.astro` shipped with its first rule's selector line missing:
#
#     <style>
#     	position: revert !important;
#     }
#
# Astro passes that through verbatim. The CSS parser hits a bare declaration
# at top level, skips to the next `}`, and drops the rule silently -- the build
# stays green and every page still looks nearly right. That is the whole reason
# this gate exists, and why the judge carries 8 self-tests (including this exact
# snippet) before it is allowed to report anything.
$results.Add((Step 'audit-css-blocks' { & node (Join-Path $PSScriptRoot 'audit-css-blocks.mjs') 2>&1 | Out-String }))

foreach ($g in $gates) {
	$script = Join-Path $PSScriptRoot "$g.ps1"
	if (-not (Test-Path -LiteralPath $script)) {
		$results.Add([pscustomobject]@{ Step = $g; Exit = 0; Seconds = 0; Note = 'SKIP (script not present)' })
		continue
	}
	$results.Add((Step $g { & powershell -NoProfile -ExecutionPolicy Bypass -File $script 2>&1 | Out-String }))
}

# -- 4. node gates -----------------------------------------------------------
$results.Add((Step 'check-ci-triggers' { & node (Join-Path $PSScriptRoot 'check-ci-triggers.mjs') 2>&1 | Out-String }))

# -- 4b. check-self-contained: astro-site must not reference Nuxt project files --
#
# "Astro runs independently, decoupled from Nuxt" is an explicit migration goal.
# The checker has existed all along (package.json script check-self-contained) but
# was NOT wired into this pipeline -- so writing `import ... from '../../app/...``
# back into astro-site left the whole run green. Decoupling was remembered by
# people rather than enforced by a gate.
# Measured when wired in: 140 files scanned, 0 out-of-bounds references.
$results.Add((Step 'check-self-contained' { & node (Join-Path $PSScriptRoot 'check-self-contained.mjs') 2>&1 | Out-String }))

# -- 4c. product-behavior gates -----------------------------------------------
#
# Nine node gates for behaviour that no existing gate could see. Each exists
# because a real defect shipped green through the whole pipeline above; the
# defect it now catches is named in its header comment in the script itself.
#
#   check-icon-swap     4 `data-icon` attributes were inert no-ops, and the
#                       replacement glyph (tabler:message-circle-quote) does
#                       not exist in Iconify at all -- the Iconify API 404s it.
#   check-flip-gates    ListTransition / Toggle / Slider were source-complete
#                       but not wired into any page, so the archive page shipped
#                       a density panel that did nothing.
#   check-list-controls the home page rendered sort / category / pagination
#                       controls with zero consumers: every control worked by
#                       not existing. Full data went into a <template> so the
#                       client can genuinely re-order.
#   check-dropped-css   four `> .chat-*` rules sat at brace depth 0, which is
#                       not valid CSS: the build stayed green and the minifier
#                       silently dropped 267px of chat layout.
#   check-affordances   keyboard hints, rel=noopener, image cursor, collapse
#                       animation -- four hint affordances, zero of them wired.
#   check-scope-anchors a top-level `:deep(X)` in Nuxt compiles to `[data-v-N] X`,
#                       i.e. it REQUIRES an ancestor from that component. Written as
#                       a bare `:global(X)` in Astro the anchor is gone and the rule
#                       fires outside the component. Shipped green once already:
#                       `/link`'s standalone feed card lost `margin:1em auto`
#                       (page 8px short) while 63-page style parity reported 0 --
#                       the broken element was outside the sampled head.
#   check-heading-ids  Nuxt Content applies three post-steps to every heading slug
#                       (collapse `--`, strip leading/trailing `-`, prefix a leading
#                       digit with `_`); Astro's rehypeHeadingIds applies none, so
#                       3 pages shipped anchors that no TOC link and no shared URL
#                       can reach. Neither page height nor computed style can see it
#                       -- an <a href="#..."> pointing at a missing id changes no box.
#                       Found by the semantic-signature probe; this gate keeps it found
#                       without a 30-minute browser run.
#   check-text-literal remark-smartypants is ON by default in Astro and OFF in Nuxt,
#                       so `"..."` and `"x"` came out as curly/ellipsis on 20 of 64
#                       pages. Page height and computed style are both blind to it:
#                       what changed is a glyph, not a box. Judged by a per-character
#                       count inequality (dist <= source) so the gate needs no network.
#                       Its first draft ("every char in dist must exist in source")
#                       could NOT go red -- the sources legitimately contain curly
#                       quotes, so the check was vacuous. Verified red/green both ways.
#   check-mdc-eval     an MDC component tag in dist means the tag was dumped as
#                       raw HTML instead of being evaluated. BlogWidget.astro
#                       used `set:html={meta.content}` for the three metaSlots in
#                       previews/example, so that page's third sidebar widget was
#                       entirely blank -- online has an <a class="link-card">, the
#                       local build had a literal <linkcard>. Page height sees a
#                       blank as a valid box, computed style sees no element at
#                       all. Judged by a zero-ambiguity list (no registered
#                       component name collides with an HTML tag), so "present"
#                       == "unevaluated". Verified red by reverting BlogWidget
#                       to set:html and rebuilding.
#   check-aria-current aria-current="page" must be equivalent to "this link points
#                       at the current page". Online it is a NuxtLink AUTOMATIC
#                       behaviour, so authors never write it; the Astro port had
#                       it only on the one link BlogSidebar computes itself, so the
#                       home page carried the mark on 1 of its 4 home links. Read
#                       online 2026-10-03: `/` marks 4/4, `/link` and
#                       `/2024/03/takagi` mark 0/3-4 -- exactly "exact match only".
#                       NO CSS on either side selects [aria-current] (surveyed), so
#                       page height and computed style are both blind to it; it is
#                       what a screen reader announces, i.e. a functional
#                       difference. Judged both directions (missing AND spurious).
#                       It found a second real defect on first run: BlogSidebar's
#                       currentMark compared a trailing-slashed Astro.url.pathname
#                       against an unslashed item.url, so /link /archive /games
#                       degraded 'page' to 'true' (5 findings, exit 1). Verified
#                       red/green both ways; the over-marking direction was proven
#                       by injecting `return 'page'` (1401 findings, exit 1).
#   check-icon-box     `.nav-icon` is an explicit 1em x 1em icon BOX; the <svg>
#                       inside it must not stay inline-level. 2026-10-03 the user
#                       reported "sidebar icons and text are not really aligned",
#                       and the measured cause was a single 1.72px: the online
#                       `.iconify` is a <span> whose glyph is a CSS mask filling
#                       the whole 21.59px box (no inline content, so its 1.4em
#                       line-height never positions anything), while the Astro
#                       port wraps the icon -- <span class="nav-icon"> around
#                       <svg width="1em" class="iconify"> -- and that svg is
#                       inline, so it sat on the parent's BASELINE. The parent
#                       carries `line-height: 1` precisely to keep the box at
#                       21.6px, which is what pulled the svg 1.72px low.
#                       Two instruments are structurally blind to it, for
#                       different reasons: STYLE_PROPS has no geometry offset in
#                       it, and `.nav-icon > .iconify` does not match on the
#                       online side at all (there is no inner svg there), so
#                       adding it to STYLE_SELECTORS would only produce a fake
#                       element-count diff. This is therefore a ONE-SIDED
#                       INVARIANT, not a cross-side comparison. It first checks
#                       that the structure it inspects still exists, so a change
#                       of icon technology fails loudly instead of going quiet.
#                       Verified red/green both ways: reverting to
#                       `display: inline` names both offending rules and exits 1.
#
# They read dist/ only, never source: a component that exists but is not
# referenced is not compiled by Astro, so "it is in the repo" is not evidence
# that it shipped.
$productGates = @(
	'check-icon-swap',
	'check-flip-gates',
	'check-list-controls',
	'check-dropped-css',
	'check-affordances',
	'check-scope-anchors',
	'check-heading-ids',
	'check-text-literal',
	'check-mdc-eval',
	'check-aria-current',
	'check-icon-box'
)
foreach ($g in $productGates) {
	$script = Join-Path $PSScriptRoot "$g.mjs"
	if (-not (Test-Path -LiteralPath $script)) {
		$results.Add([pscustomobject]@{ Step = $g; Exit = 0; Seconds = 0; Note = 'SKIP (script not present)' })
		continue
	}
	$results.Add((Step $g { & node $script 2>&1 | Out-String }))
}

# -- 4d. preview-guard self-test ------------------------------------------------
#
# Every live gate (compare-ui-parity, probe-subtree) has to start an `astro preview`
# on its own port, and Astro 7 keeps a CROSS-PORT registry that refuses a new
# server while any entry survives. The old workaround was an unconditional
# `astro preview stop` before every run -- which does not look at the port, so it
# also killed a preview the USER had started for this project.
#
# lib/preview-guard.mjs now negotiates the port instead. This step is its proof:
# it starts real previews and asserts the three branches, including the one that
# matters most -- refusing must NOT kill the other server.
# It costs ~30s (two preview boots), so it is a real step rather than an import.
$results.Add((Step 'preview-guard-selftest' { & node (Join-Path $PSScriptRoot 'preview-guard.selftest.mjs') 2>&1 | Out-String }))

# -- 4a. interaction-check is deliberately NOT run here -----------------------
#
# Run it on its own instead:  node scripts/interaction-check.mjs
#
# Why it is not in the pipeline, stated plainly because "moved it out" is easy
# to read as "quietly dropped a failing gate". It is not: this gate is
# *unreliable in the pipeline*, while being *reliable standalone*, and a gate
# that cries wolf is worse than no gate -- it trains you to ignore red, and the
# next red is a real one.
#
# Evidence that the SITE is fine and the GATE is the problem:
#   - Re-verifying every assertion's exact selector against dist, statically:
#     12/13 pass. The one miss (domain-icon) is also correct -- that article
#     has a single body link and it maps to no icon.
#   - The browser log during failing runs contains only third-party resource
#     errors (a Cloudflare 525 and the rum beacon's CORS), never a module load
#     failure, and the served .js files are 200 with `text/javascript` + utf-8.
#   - Standalone: 25/25, repeatedly, including right after reclaiming memory.
#   - In-pipeline: 7/25 and 10/25, with every assertion message being some
#     variant of "element not found" (0 paragraphs marked, no z-link, no
#     heading anchor) for markup that is provably present in dist.
#
# Ruled out along the way, each by experiment rather than reasoning: port
# contention, node_modules/.astro state (data-store.json mtime never moved),
# timing (waiting 30s changed nothing), check-build-warnings touching dist
# (a plain rebuild restored 12/13), free memory (it mattered once, but it
# fails at 3.5GB too), the PowerShell pipeline (Start-Process fails the same),
# and MIME/charset (both correct).
#
# The remaining lead is that the client's module graph intermittently fails to
# execute. That is a harness question, and until it is answered the honest
# thing is to run this gate where it is trustworthy instead of embedding it
# where it is not.

# -- 4a. live gates (need the production site to be reachable) ---------------
#
# These are the only gates with an external dependency. They are the ones that
# can catch a class nothing offline can: Astro generating a URL set that is
# internally consistent but different from what is live, which turns a cutover
# into a site-wide 404 with every offline gate still green.
#
# An unreachable production site must SKIP, never FAIL. A flaky network is not
# a migration defect, and a gate that cries wolf gets ignored.
function Test-LiveReachable($url) {
	try {
		$r = Invoke-WebRequest -Uri $url -Method Head -TimeoutSec 10 -UseBasicParsing
		return ($r.StatusCode -lt 500)
	}
	catch {
		return $false
	}
}

$liveBase = 'https://blog.sotkg.com'
if (Test-LiveReachable "$liveBase/") {
	$env:BASE_URL = $liveBase
	$results.Add((Step 'live:sitemap' { & node (Join-Path $PSScriptRoot 'compare-remote-sitemap.mjs') 2>&1 | Out-String }))
	Remove-Item Env:\BASE_URL -ErrorAction SilentlyContinue
	# Called in-process, not via `powershell -File`: -File expands array
	# parameters into positional args, so the accept-list would arrive as
	# garbage. The allow-list itself is the script's own default.
	$results.Add((Step 'live:head' {
		& (Join-Path $PSScriptRoot 'check-head-vs-live.ps1') -Remote $liveBase -Dist (Join-Path $root 'dist') 2>&1 | Out-String
	}))
	# Full-site page-height parity against the LIVE Nuxt site, measured with
	# every cross-origin request blocked on both sides.
	#
	# Why this is the gate that finally makes "identical to the old Nuxt"
	# testable: the site's images and fonts all live on remote CDNs with no
	# reserved height, and the two sides run on different hosts (EdgeOne CDN
	# vs localhost). Measuring on the real network, remote load timing
	# outweighs real differences -- 63 pages produced 19 "unstable" verdicts
	# and a diff list nobody could act on. Blocking cross-origin on both sides
	# pins the premise, so whatever difference survives is layout, not luck.
	#
	# It does not cover fonts/images/comments under real network conditions;
	# that is what compare-page-heights.mjs and the two gates above are for.
	# Slow by nature (every page measured twice per side) -- that is the cost
	# of a number you can trust, and it is why it prints per-page progress.
	#
	# The page list is NOT just the sitemap: it also carries /preview,
	# /previews/example and /previews/bangumi-components, which robots.txt
	# Disallow keeps out of sitemap.xml. Those three carry 12 MDC components
	# that appear nowhere in content/posts (blur, card-list, link-banner,
	# link-card, meta-aside-bar, meta-aside-foo, meta-copyright, poetry,
	# project-group, series-group, timeline, video-embed) -- before this,
	# none of them had ever been measured by anything. See scripts/lib/page-list.mjs.
	#
	# Two things were added to the same pass (no extra page loads):
	#   * a SEMANTIC signature multiset (visible links / buttons / inputs /
	#     media / headings). Page height only sees the total, and the style
	#     gate only sees the selectors in its table, so "one link is missing"
	#     was invisible to both. That is how the missing back-home link in
	#     /preview's <h1> survived.
	#   * an ONLINE re-measure of any page whose offline delta exceeds
	#     tolerance. Blocking cross-origin is deliberate, but it also
	#     fabricates deltas: /2025/10/lemmy-fediverse-deploy measures
	#     -19px offline and exactly 0px online, because the live page's own
	#     layout grows 19.03px when its remote resources are blocked.
	$results.Add((Step 'live:ui-parity' {
		& node (Join-Path $PSScriptRoot 'compare-ui-parity.mjs') --mode=offline --deep=4 2>&1 | Out-String
	}))
	if ($Styles) {
		$results.Add((Step 'live:style-parity' {
			& node (Join-Path $PSScriptRoot 'compare-ui-parity.mjs') --styles 2>&1 | Out-String
		}))
	}
	if ($Mobile) {
		# Phone width. The desktop sweep above cannot see a broken breakpoint:
		# identical rendering at 1600px is fully compatible with a collapsed grid
		# or an overridden `display` at 390px. Verified: measuring one page at
		# both widths gives 2624 vs 3895, so the override really takes effect.
		#
		# The semantic multiset matters MORE at this width, not less: elements
		# hidden on the desktop run are exactly the ones this run can see.
		# /preview's back-home link in the <h1> is `.hide-above-mobile` -- on
		# the 1600 sweep it is display:none on both sides and invisible to the
		# check, which is a second reason its absence went unnoticed.
		$results.Add((Step 'live:ui-parity-mobile' {
			& node (Join-Path $PSScriptRoot 'compare-ui-parity.mjs') --mode=offline --deep=4 --width=390 --height=844 2>&1 | Out-String
		}))
		# Computed styles at the SAME width. The height sweep only compares the
		# total, so it cannot see a swapped margin or a dropped padding inside a
		# box whose outer size happens to match.
		#
		# Why this step exists: `.astro-compare/style-parity-w390x844.json` had
		# been produced by hand for several rounds, but there was no Step for it
		# -- a measurement that nobody is forced to re-run is not a gate, it is a
		# snapshot. Same rule that put check-scope-anchors.mjs in 4c.
		$results.Add((Step 'live:style-parity-mobile' {
			& node (Join-Path $PSScriptRoot 'compare-ui-parity.mjs') --styles --width=390 --height=844 2>&1 | Out-String
		}))
	}
	if ($Dark) {
		# Colours, not geometry. Both sides default to "follow the system", so
		# the tool flips prefers-color-scheme through CDP -- a symmetric switch.
		# It refuses to report anything unless <html> really carries .dark, so a
		# silently-ignored override cannot pass as a clean dark-mode run.
		$results.Add((Step 'live:style-parity-dark' {
			& node (Join-Path $PSScriptRoot 'compare-ui-parity.mjs') --styles --theme=dark 2>&1 | Out-String
		}))
	}
}
else {
	foreach ($skipped in @('live:sitemap', 'live:head', 'live:ui-parity')) {
		$results.Add([pscustomobject]@{ Step = $skipped; Exit = 0; Seconds = 0; Note = 'SKIP (live site unreachable)' })
	}
	if ($Styles) {
		$results.Add([pscustomobject]@{ Step = 'live:style-parity'; Exit = 0; Seconds = 0; Note = 'SKIP (live site unreachable)' })
	}
	if ($Mobile) {
		$results.Add([pscustomobject]@{ Step = 'live:ui-parity-mobile'; Exit = 0; Seconds = 0; Note = 'SKIP (live site unreachable)' })
		$results.Add([pscustomobject]@{ Step = 'live:style-parity-mobile'; Exit = 0; Seconds = 0; Note = 'SKIP (live site unreachable)' })
	}
	if ($Dark) {
		$results.Add([pscustomobject]@{ Step = 'live:style-parity-dark'; Exit = 0; Seconds = 0; Note = 'SKIP (live site unreachable)' })
	}
}

# -- 5. check-build-warnings runs LAST, and that is load-bearing ---------------
#
# It has to. `astro build --outDir <tmp>` keeps dist/ untouched but still runs a
# full build against the shared working tree, and it is one of the operations
# that opens the window in which browser-driven gates go flaky (see 4a above).
# Measured: everything after it in the same run is unreliable, everything before
# it is fine. Running it last means the fragile window contains nothing.
#
# NOTE: this block used to sit BEFORE the live gates. The 2026-10-02 run then had
# both `live:ui-parity` and `live:style-parity` fail with
# `FAIL: preview never came up` (60.8s each -- exactly the waitHttp timeout).
#
# That was NOT an ordering problem: reordering reproduced it unchanged. The real
# cause is that Astro 7.x `astro preview` keeps a cross-port registry of running
# preview servers, and any leftover entry blocks a new one. compare-ui-parity.mjs
# now runs `astro preview stop` before starting its own. The reordering is kept
# because it matches what the original note above already said ("runs LAST") --
# but it was not the fix, and the earlier comment claiming it was has been
# corrected here so the next reader is not sent down the same wrong path.
$results.Add((Step 'check-build-warnings' { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-build-warnings.ps1') 2>&1 | Out-String }))

# -- 5. summary --------------------------------------------------------------
''
'================ ACCEPTANCE ================'
$results | Format-Table -AutoSize -Wrap
''
'NOT RUN HERE (deliberate, see section 4a):'
'  interaction-check   run it on its own:  node scripts/interaction-check.mjs'
'                      26 assertions in a real headless Chrome + 67-page sweep.'
'                      It is reliable standalone and unreliable in this pipeline,'
'                      and a gate that cries wolf is worse than no gate.'
''
'OPT-IN:'
'  -Styles            also run live:style-parity (computed styles vs the live site).'
'                      Off by default: it measures the whole site a second time.'
'                      Turn it on before a cutover -- page height is blind to'
'                      color / border / box-shadow differences.'
'  -Mobile            re-run live:ui-parity at 390x844 and treat a diff there as'
'                      a failure too. Off by default because the site has many'
'                      @media (max-width: 768px) rules: desktop-identical does NOT'
'                      imply mobile-identical, and a broken breakpoint only shows'
'                      up at the narrow width. Non-default widths write to their'
'                      own .astro-compare/ui-parity-*p-offline-w390x844.json so a'
'                      phone run can never silently overwrite the desktop baseline.'
'  -Dark              re-run the computed-style comparison with prefers-color-scheme'
'                      forced to dark. Off by default. Dark mode swaps the whole'
'                      token set and page height is blind to colour, so this is'
'                      the ONLY instrument that can say anything about it. The tool'
'                      aborts unless <html> really carries .dark, so an ignored'
'                      override cannot be reported as a clean dark-mode run.'
''
$failed = @($results | Where-Object { $_.Exit -ne 0 })
"total: $($results.Count)   passed: $($results.Count - $failed.Count)   failed: $($failed.Count)"
if ($failed.Count -gt 0) {
	''
	'FAILED STEPS:'
	foreach ($f in $failed) { "  - $($f.Step)  (exit $($f.Exit))" }
	exit 1
}
'ACCEPTED: all steps green'
exit 0
