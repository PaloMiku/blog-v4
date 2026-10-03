param(
	# Analyze an already-captured build log instead of running a build.
	[string] $LogPath,
	# Refuse to run a build (CI case: the caller already built).
	[switch] $NoBuild,
	# Where the isolated build writes its output. Deleted afterwards.
	[string] $OutDir
)

$ErrorActionPreference = 'Stop'

# Zero-warning build gate.
#
# The failure mode this exists for:
#   Astro + Lightning CSS does NOT fail a build over an unknown selector.
#   It prints
#     'deep' is not recognized as a valid pseudo-class. Did you mean '::deep'...
#   and then silently DROPS the rule. `PostHeader.astro` had two live `:deep()`
#   rules carried over from Vue, so the article header image lost both its
#   100% width/height fill and `object-fit: cover`. The build was green, every
#   other gate was green, and the only symptom was a subtly wrong picture.
#   The same "warn and continue" shape applies to unresolvable imports and to
#   MDX nodes the compiler cannot represent.
#
#   Nothing was reading the build log, so nothing caught it.
#
# Isolation:
#   `astro build --outDir <tmp>` keeps the shared `dist/` tree untouched.
#   NOT isolated: the content-layer cache under `node_modules/.astro/`. Two
#   concurrent Astro processes still contend there, so run this when no other
#   build or dev server is active.
#
# Exit codes: 0 = PASS, 1 = FAIL, 2 = cannot run
#
# NOTE: ASCII-only. Windows PowerShell 5.1 reads a BOM-less .ps1 using the
# system ANSI code page; a non-ASCII comment gets mis-decoded and swallows the
# following newline, which silently skips the next executable statement.

$siteRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$astroBin = Join-Path $siteRoot 'node_modules\.bin\astro.cmd'

# -- warning allowlist --------------------------------------------------------
# Every entry needs a reason. A bare allowlist is how a real regression gets
# waved through, so adding a pattern here is a deliberate act, not a cleanup.
$allow = @(
	@{
		Pattern = 'MODULE_LEVEL_DIRECTIVE'
		Reason  = 'Rollup noise from MDX head injection. Verified harmless: the MDX head export demonstrably takes effect (docs/astro-phase1-findings.md section E, dead-code/hygiene list). Not a correctness signal.'
	}
	@{
		Pattern = 'chunks are larger than 500 kB'
		Reason  = 'Mermaid + cytoscape are a heavy diagram library. They are behind a dynamic import, so only pages that actually contain a diagram pay for them; a chunk-size warning here is not a per-page payload regression (see the per-page JS+CSS numbers in docs/astro-phase1-findings.md).'
	}
	@{
		Pattern = 'conflicts with higher priority route'
		Reason  = 'Expected: the site has both a dedicated /link route and a catch-all /[...slug]. The catch-all also matches /link, and Astro says so every build. The dedicated route wins, so the rendered page is correct (compare-urls and compare-titles both pass on 67 pages).'
	}
)

# -- warning detectors --------------------------------------------------------
# Order matters only for reporting; every match is reported.
$rules = @(
	@{
		Name    = 'css-invalid-selector'
		Pattern = 'not recognized as a valid'
		Why     = 'Lightning CSS rejected a selector or at-rule. The rule is dropped from the output; nothing else fails.'
	},
	@{
		Name    = 'css-syntax'
		Pattern = 'Unable to parse|unexpected token|Unexpected end of (CSS|stylesheet)'
		Why     = 'Lightning CSS could not parse a stylesheet. Rules are dropped silently.'
	},
	@{
		Name    = 'mdx-unknown-node'
		Pattern = 'Cannot handle unknown node'
		Why     = 'MDX emitted a node type the compiler cannot represent (e.g. a raw html node). The content is dropped.'
	},
	@{
		Name    = 'dependency-resolution'
		Pattern = 'Cannot find|failed to resolve'
		Why     = 'An import or asset could not be resolved. The reference is dropped from the bundle.'
	},
	@{
		Name    = 'generic-warn'
		Pattern = '\[\s*warn(ing)?\s*\]|^\s*warn(ing)?\b|\bwarn(ing)?:\s'
		Why     = 'Catch-all for toolchain warnings with no dedicated rule. Listed explicitly so the next one forces a decision.'
	}
)

# -- get the log --------------------------------------------------------------
$exitCode = $null

function Remove-Ansi([string] $s) {
	return [regex]::Replace($s, "$([char]27)\[[0-9;?]*[ -/]*[@-~]", '')
}

function Invoke-IsolatedBuild {
	param([string] $SiteRoot, [string] $AstroBin, [string] $OutPath)

	if (-not (Test-Path -LiteralPath $AstroBin)) {
		throw "astro CLI not found at $AstroBin (run pnpm install first)"
	}
	$psi = New-Object System.Diagnostics.ProcessStartInfo
	# cmd.exe is required: a .cmd shim cannot be started by CreateProcess when
	# UseShellExecute is false.
	$psi.FileName = $env:ComSpec
	$psi.Arguments = '/c ""{0}" build --outDir "{1}""' -f $AstroBin, $OutPath
	$psi.WorkingDirectory = $SiteRoot
	$psi.UseShellExecute = $false
	$psi.RedirectStandardOutput = $true
	$psi.RedirectStandardError = $true
	$psi.CreateNoWindow = $true

	$p = [System.Diagnostics.Process]::Start($psi)
	# Read both pipes before WaitForExit: a full pipe buffer would deadlock.
	$stdout = $p.StandardOutput.ReadToEnd()
	$stderr = $p.StandardError.ReadToEnd()
	$p.WaitForExit()
	return @{ Code = $p.ExitCode; Text = ($stdout + "`n" + $stderr) }
}

$tempOut = $null
if ($LogPath) {
	if (-not (Test-Path -LiteralPath $LogPath -PathType Leaf)) {
		"ERROR: log not found: $LogPath"
		'RESULT: ERROR - cannot read build log'
		exit 2
	}
	$log = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $LogPath).Path)
	"source: existing log $LogPath"
}
elseif ($NoBuild) {
	'ERROR: -NoBuild was given but no -LogPath was supplied.'
	'RESULT: ERROR - nothing to analyze'
	exit 2
}
else {
	if (-not $OutDir) {
		# Isolated output: never touch the shared dist/ tree.
		#
		# MUST live on the same drive as the project. Astro finishes a static build
		# by `rename()`-ing the prerendered assets out of `.astro/.prerender` into
		# the outDir; across drives (project on D:, GetTempPath on C:) that throws
		# `EXDEV: cross-device link not permitted` and the gate reports a build
		# failure that has nothing to do with warnings. Put it beside the project
		# instead and clean it up afterwards.
		$tempOut = Join-Path $siteRoot ('.astro-warn-gate-' + $PID)
		$OutDir = $tempOut
	}
	'--- running isolated build ---'
	"  outDir: $OutDir"
	'  note: dist/ is NOT written.'
	'  WARNING: this still runs a full build against the shared working tree,'
	'           which opens a window where scripts/interaction-check.mjs goes'
	'           flaky (every click/typing assertion fails, every pure query'
	'           passes, no module load error in the browser log). Measured'
	'           25/25 standalone vs 7/25 started right after this gate.'
	'           Run this gate LAST in scripts/acceptance.ps1.'
	$r = Invoke-IsolatedBuild -SiteRoot $siteRoot -AstroBin $astroBin -OutPath $OutDir
	$log = $r.Text
	$exitCode = $r.Code
	"  build exit code: $exitCode"
	$tempOut = $OutDir
}

# -- scan ---------------------------------------------------------------------
$lines = (Remove-Ansi $log) -split "`r?`n"

$hits = @()
$allowed = @{}
$total = 0

for ($i = 0; $i -lt $lines.Count; $i++) {
	$line = $lines[$i]
	if (-not $line.Trim()) { continue }
	$total++

	$whitelisted = $false
	# Vite's reporter prints some warnings across several lines, and the FIRST
	# line is only a header with no message ("[WARN] [vite] [plugin
	# builtin:vite-reporter]"). Matching line-by-line flags that bare header even
	# when the body right below it is allowlisted. Look ahead a few lines and let
	# an allowlisted body cover its own header, instead of blanket-allowing the
	# header pattern (which would also hide any future vite-reporter warning).
	if ($line -match '\[WARN\].*\[plugin .*\]' -and $line.TrimEnd() -match '\]$') {
		$window = ($lines[($i + 1)..([Math]::Min($i + 6, $lines.Count - 1))] -join "`n")
		foreach ($a in $allow) {
			if ($window -match $a.Pattern) {
				if (-not $allowed.ContainsKey($a.Pattern)) {
					$allowed[$a.Pattern] = @{ Reason = $a.Reason; Count = 0 }
				}
				$allowed[$a.Pattern].Count++
				$whitelisted = $true
				break
			}
		}
	}
	if ($whitelisted) { continue }

	foreach ($a in $allow) {
		if ($line -match $a.Pattern) {
			if (-not $allowed.ContainsKey($a.Pattern)) {
				$allowed[$a.Pattern] = @{ Reason = $a.Reason; Count = 0 }
			}
			$allowed[$a.Pattern].Count++
			$whitelisted = $true
			break
		}
	}
	if ($whitelisted) { continue }

	foreach ($r in $rules) {
		if ($line -match $r.Pattern) {
			$text = $line.Trim()
			if ($text.Length -gt 200) { $text = $text.Substring(0, 200) + '...' }
			$hits += [pscustomobject]@{ Line = $i + 1; Name = $r.Name; Why = $r.Why; Text = $text }
			break
		}
	}
}

# -- report -------------------------------------------------------------------
''
'--- build warnings ---'
"  scanned $total non-empty log line(s)"

foreach ($k in ($allowed.Keys | Sort-Object)) {
	"  ALLOW $($k)  x$($allowed[$k].Count)"
	"          $($allowed[$k].Reason)"
}

if ($hits.Count -eq 0) {
	'  OK    no warning matched any detector'
}
else {
	"  --- $($hits.Count) FAILING line(s) ---"
	foreach ($h in $hits) {
		"  [$($h.Name)] line $($h.Line): $($h.Text)"
		"      why: $($h.Why)"
	}
}

if ($exitCode -ne $null -and $exitCode -ne 0) {
	"  FAIL  build exited with code $exitCode"
}

# Always clean up the isolated output directory.
if ($tempOut) {
	if (Test-Path -LiteralPath $tempOut) {
		Remove-Item -LiteralPath $tempOut -Recurse -Force -ErrorAction SilentlyContinue
		"  cleaned isolated outDir: $tempOut"
	}
}

$failCount = $hits.Count
if ($exitCode -ne $null -and $exitCode -ne 0) { $failCount++ }

''
if ($failCount -eq 0) {
	'RESULT: PASS - build is warning-free'
	exit 0
}
"RESULT: FAIL - $failCount warning/build problem(s)"
exit 1
