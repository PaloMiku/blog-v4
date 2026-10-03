$ErrorActionPreference = 'Stop'

# Dead-CSS gate.
#
# The failure mode this exists for:
#   Nuxt's DOM puts a class on an element; the Astro port does not; but the Astro
#   CSS bundle still carries rules for that class. Result: the rules match
#   nothing, and nobody notices -- every other gate still passes, because they
#   only assert that text / urls / titles / dates survived.
#
#   Concrete instances found by screenshot review:
#     - `.post-subtitle`  : `subtitle` was missing from the content schema, so 13
#                           published articles lost their subtitle line.
#     - `.no-toc`         : the Toc widget was gated on `headings.length > 0`,
#                           so the whole component vanished instead of rendering
#                           its `.no-toc` placeholder.
#     - `.carousel-action` : the prev/next buttons were never ported, only the CSS.
#     - `.archive-age`    : `component.stats` was absent from the Astro app config.
#
# Also catches the inverse of the Prose* gap: a whole component ported as markup
# with no stylesheet, or with a stylesheet no element can match.
#
# NOTE: ASCII-only (Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI).
# Paths resolve from $PSScriptRoot, not the process CWD (findings 85.6).

$siteRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dist = Join-Path $siteRoot 'dist'
$baseline = Resolve-Path (Join-Path $siteRoot 'baseline\nuxt') -ErrorAction SilentlyContinue
if (-not $baseline) { 'FAIL: frozen Nuxt baseline missing. Run: pnpm generate, then node scripts/freeze-baseline.mjs'; exit 1 }
$baseline = $baseline.Path

# Classes that legitimately exist only after client-side scripts run, or that the
# Astro port intentionally renders differently. Every entry needs a reason --
# a bare allowlist is how a regression gets waved through.
$allow = @{
	'collapsed'      = 'code block collapse state, applied by src/lib/prose-enhance.ts'
	'is-collapsed'   = 'code block collapse icon state, same script'
	'wrap'           = 'code block soft-wrap toggle state, same script'
	'active'         = 'Vue/Nuxt transition bookkeeping, not a styling hook'
	'list-enter-active' = 'Vue transition bookkeeping, not a styling hook'
	'list-leave-active' = 'Vue transition bookkeeping, not a styling hook'
	'list-enter-from'   = 'Vue transition bookkeeping, not a styling hook'
	'list-leave-to'     = 'Vue transition bookkeeping, not a styling hook'
	'list-move'         = 'Vue transition bookkeeping, not a styling hook'
	'katex'         = 'katex ships its own stylesheet via katex.min.css import'
	'language-bash'  = 'nuxt-content adds a language-* class the Astro shiki pass does not'
	'language-text'  = 'same as language-bash'
	'language-yaml'  = 'same as language-bash'
	'language-json'  = 'same as language-bash'
	'language-css'   = 'same as language-bash'
	'language-js'    = 'same as language-bash'
	'language-javascript' = 'same as language-bash'
	'language-vue'   = 'same as language-bash'
	'language-md'    = 'same as language-bash'
	'language-markdown' = 'same as language-bash'
	'language-mdc'   = 'same as language-bash'
	'language-shell' = 'same as language-bash'
	'language-sh'    = 'same as language-bash'
	# Known open defect, deliberately NOT hidden: block math ($$...$$) inside an
	# MDX JSX block is not picked up by remark-math, so rehype-katex never emits
	# the display wrapper. Verified pre-existing (reproduces with prose.ts
	# disabled) and scoped to the robotsNotIndex demo page. Keep this entry until
	# the defect is actually fixed -- do not delete it to make the gate green.
	'katex-display'  = 'KNOWN OPEN DEFECT: block math inside MDX JSX blocks is not parsed (see docs/astro-phase1-findings.md)'
	# ProseCode's `copy` button is added at runtime by src/lib/prose-enhance.ts
	# (the <code copy> element is an uncompiled MDX JSX node, invisible to
	# rehype), so it is absent from static HTML by design.
	'copyable'       = 'ProseCode copy state, applied at runtime by src/lib/prose-enhance.ts'
	'copy-button'    = 'ProseCode copy button, same script'
}

function Get-PageMap($root) {
	$map = @{}
	foreach ($f in Get-ChildItem $root -Recurse -Filter *.html -File) {
		$rel = $f.FullName.Substring($root.Length + 1) -replace '\\', '/'
		$map[$rel] = $f.FullName
	}
	return $map
}

function Get-ClassSet($path) {
	$h = [System.IO.File]::ReadAllText($path)
	# Strip script/style first: nuxt inlines every scoped <style> into the page,
	# so a naive text search finds class names that are only ever CSS selectors.
	$h = [regex]::Replace($h, '(?s)<script.*?</script>', '')
	$h = [regex]::Replace($h, '(?s)<style.*?</style>', '')
	$set = New-Object 'System.Collections.Generic.HashSet[string]'
	foreach ($m in [regex]::Matches($h, 'class="([^"]*)"')) {
		foreach ($c in ($m.Groups[1].Value -split '\s+')) {
			if ($c) { [void]$set.Add($c) }
		}
	}
	return $set
}

function Get-BuiltCss($root) {
	$sb = New-Object System.Text.StringBuilder
	$dir = Join-Path $root '_astro'
	if (Test-Path $dir) {
		foreach ($f in Get-ChildItem $dir -Filter *.css -File) {
			[void]$sb.AppendLine([System.IO.File]::ReadAllText($f.FullName))
		}
	}
	foreach ($f in Get-ChildItem $root -Recurse -Filter *.html -File) {
		$h = [System.IO.File]::ReadAllText($f.FullName)
		foreach ($m in [regex]::Matches($h, '(?s)<style[^>]*>(.*?)</style>')) {
			[void]$sb.AppendLine($m.Groups[1].Value)
		}
	}
	return $sb.ToString()
}

$astroPages = Get-PageMap $dist
$nuxtPages = Get-PageMap $baseline
$css = Get-BuiltCss $dist

$allAstro = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($rel in $astroPages.Keys) {
	foreach ($c in (Get-ClassSet $astroPages[$rel])) { [void]$allAstro.Add($c) }
}
$allNuxt = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($rel in $nuxtPages.Keys) {
	foreach ($c in (Get-ClassSet $nuxtPages[$rel])) { [void]$allNuxt.Add($c) }
}

'--- 1. classes the Nuxt DOM uses, the Astro DOM never does, and the Astro CSS still styles ---'
$fail = 0
$reported = 0
foreach ($c in ($allNuxt | Sort-Object)) {
	# iconify class names are an implementation detail: Nuxt renders
	# <span class="i-tabler:moon"> via @iconify/vue, astro-icon emits inline <svg>.
	if ($c -like 'i-*') { continue }
	if ($allAstro.Contains($c)) { continue }
	if ($css -notmatch ('\.' + [regex]::Escape($c) + '(?![\w-])')) { continue }
	if ($allow.ContainsKey($c)) {
		"  ALLOW  .$c  -- $($allow[$c])"
		continue
	}
	$reported++
	"  DEAD   .$c"
}
if ($reported -eq 0) { '  OK    no unstyled-forever class' } else { $fail += $reported }

'--- 2. the Prose* layer actually landed in the build ---'
# The ProsePre/ProseA/ProseP/ProseTable port is the biggest single piece of the
# migration; assert its anchors exist in both markup and CSS so a silent drop of
# either half is caught here rather than by eye.
$sample = Join-Path $dist '2025/10/misskey-fediverse-deploy/index.html'
if (-not (Test-Path -LiteralPath $sample)) {
	'  SKIP  sample article not built'
	$fail++
}
else {
	$h = [System.IO.File]::ReadAllText($sample)
	$expect = @(
		@('<figure class="z-codeblock"', 'ProsePre wrapper'),
		@('class="operations"', 'ProsePre copy / wrap buttons'),
		@('class="prose-paragraph"', 'ProseP paragraph class'),
		@('class="z-link"', 'ProseA link class')
	)
	foreach ($e in $expect) {
		if ($h.Contains($e[0])) { "  OK    $($e[1])" } else { "  MISS  $($e[1])  ($($e[0]))"; $fail++ }
	}
	foreach ($e in @('.z-codeblock', '.prose-paragraph', '.z-link', '.md-table')) {
		if ($css -match [regex]::Escape($e)) { "  OK    css for $e" } else { "  MISS  css for $e"; $fail++ }
	}
	# Syntax colouring only works if the shiki variables are mapped to a colour.
	# Nuxt emits inline color: at runtime, Astro emits variables only -- without
	# this mapping every token silently inherits the body colour.
	if ($css -match 'color:\s*var\(--shiki-light\)') { '  OK    shiki light-mode colour mapping' } else { '  MISS  shiki light-mode colour mapping (code blocks render unhighlighted)'; $fail++ }
}

'--- 3. code block counts per page must match the baseline ---'
# ⚠️ Both sides MUST be stripped first. Nuxt inlines every scoped <style> into
#    the page, and ProsePre's stylesheet mentions `.z-codeblock` several times,
# so a raw text count reports exactly double for every page (nuxt=2N astro=N).
# That is the same false-positive shape that made an earlier draft of this
# gate report 70 phantom regressions.
function Strip-Markup($h) {
	$h = [regex]::Replace($h, '(?s)<script.*?</script>', ' ')
	return [regex]::Replace($h, '(?s)<style.*?</style>', ' ')
}
$tn = 0
$ta = 0
$diff = 0
# Known per-page deltas. Listed rather than silently tolerated so a *new*
# divergence still fails the gate.
$knownDelta = @{
	'previews/example/index.html' = 'demo page: nuxt-content renders only 11 of the ~50 fences in content/previews/example.md, Astro renders 43. Content gap in the Nuxt baseline, not a port defect.'
	'link/index.html'             = 'link page: astro renders the code block in the friend-link instructions, nuxt renders none.'
	'2025/10/clarity-resource-list/index.html' = @'
astro renders one more code block, and it is not visible: the extra <figure
class="z-codeblock"> sits inside <div class="tab-panel" data-tab-panel="2" hidden>,
the unselected second tab, holding the ::resource-list MDC source. Measured page
height on that page is d=-10px, which is the share-button difference every article
page has -- the hidden panel contributes 0px, so the *visible* count matches.

Nuxt Content swallows that fence inside the container block, so the "语法" tab
there is empty on the live site; Astro shows the author-intended source. Keeping
Astro. Related: compare-ui-parity.mjs had a 600px ACCEPTED entry for this path
for an older, larger difference (Nuxt rendering `# tab2` -- WITH a leading space --
as a visible <h1> plus a default-expanded block). Nuxt commit 1e78213 removed
that space, the +465px no longer reproduces, and that entry has been deleted; this
one records what is actually left: an invisible DOM node.
'@
}
foreach ($rel in $astroPages.Keys) {
	if (-not $nuxtPages.ContainsKey($rel)) { continue }
	$nh = Strip-Markup ([System.IO.File]::ReadAllText($nuxtPages[$rel]))
	$ah = Strip-Markup ([System.IO.File]::ReadAllText($astroPages[$rel]))
	# Nuxt renders <figure class="z-codeblock" ...>; astro does the same.
	$cn = ([regex]::Matches($nh, '<figure class="z-codeblock')).Count
	$ca = ([regex]::Matches($ah, '<figure class="z-codeblock')).Count
	$tn += $cn
	$ta += $ca
	if ($cn -eq $ca) { continue }
	if ($knownDelta.ContainsKey($rel)) {
		"  KNOWN $rel  nuxt=$cn astro=$ca"
		"        $($knownDelta[$rel])"
		continue
	}
	$diff++
	"  DIFF  $rel  nuxt=$cn astro=$ca"
}
"  nuxt total=$tn  astro total=$ta  unexpected pages differing=$diff"
if ($diff -gt 0) { $fail += $diff }

'--- 4. ProseA domain icons render somewhere ---'
# The single sample page in section 2 may legitimately have no external links,
# so scan the whole build instead of asserting on one file.
$icons = 0
foreach ($rel in $astroPages.Keys) {
	$h = Strip-Markup ([System.IO.File]::ReadAllText($astroPages[$rel]))
	$icons += ([regex]::Matches($h, 'domain-icon')).Count
}
if ($icons -gt 0) { "  OK    $icons domain icon(s) across the build" } else { '  MISS  no ProseA domain icon anywhere'; $fail++ }

''
if ($fail -eq 0) { 'RESULT: PASS - no dead classes, prose layer complete'; exit 0 }
"RESULT: FAIL - $fail problem(s)"
exit 1
