$ErrorActionPreference = 'Stop'
# Analyzes the FROZEN Nuxt baseline (baseline/nuxt), which is what
# docs/baseline-nuxt.md documents. The Nuxt source tree is gone, so this script
# can no longer rebuild that baseline -- scripts/freeze-baseline.mjs does.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$p = (Resolve-Path (Join-Path $here '..\baseline\nuxt')).Path

function Get-PageAssets($rel) {
	$seg = $rel.TrimStart('/')
	$f = if ($seg -eq '') { Join-Path $p 'index.html' } else { Join-Path $p $seg }
	if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { $f = Join-Path $p "$seg/index.html" }
	if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { $f = Join-Path $p "$seg.html" }
	if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { return [PSCustomObject]@{ Page = $rel; Missing = $true } }

	$html = [System.IO.File]::ReadAllText($f)
	$scripts = @([regex]::Matches($html, 'src="(/_nuxt/[^"]+\.js)"') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
	$preload = @([regex]::Matches($html, 'href="(/_nuxt/[^"]+\.(?:js|css))"') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
	$css = @([regex]::Matches($html, 'href="(/_nuxt/[^"]+\.css)"') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)

	# NOTE: every operand must be array-wrapped, otherwise PowerShell
	# coerces the arrays to a single string during `+`.
	$all = @(@($scripts) + @($preload) + @($css) | Select-Object -Unique)

	$bytes = 0
	$missing = 0
	foreach ($a in $all) {
		$af = Join-Path $p $a.TrimStart('/')
		if (Test-Path -LiteralPath $af) { $bytes += (Get-Item -LiteralPath $af).Length } else { $missing++ }
	}

	[PSCustomObject]@{
		Page = $rel; Scripts = $scripts.Count; Preload = $preload.Count
		CSS = $css.Count; Total = $all.Count; Missing = $missing
		KB = [math]::Round($bytes / 1KB, 1)
		HtmlKB = [math]::Round((Get-Item -LiteralPath $f).Length / 1KB, 1)
	}
}

$pages = @('/', '/archive', '/link', '/2025/11/riddle-joker', '/2025/05/gal-up', '/games/galgames/clannad', '/about')
'=== per-page asset payload ==='
$rows = foreach ($pg in $pages) { Get-PageAssets $pg }
$rows | Format-Table -AutoSize

'=== article page: does it reference sqlite / studio / payload? ==='
$html = [System.IO.File]::ReadAllText((Join-Path $p '2025/11/riddle-joker/index.html'))
"  sqlite3  : $([bool]($html -match 'sqlite3'))"
"  _studio  : $([bool]($html -match '_studio-app'))"
"  _payload : $([bool]($html -match '_payload'))"

'=== HTML size distribution across all pages ==='
$htmls = Get-ChildItem $p -Recurse -File -Filter *.html
$kb = @($htmls | ForEach-Object { $_.Length / 1KB } | Sort-Object)
"  min {0:N1} KB / median {1:N1} KB / max {2:N1} KB / total {3:N2} MB" -f `
	$kb[0], $kb[[int]($kb.Count / 2)], $kb[-1], (($htmls | Measure-Object Length -Sum).Sum / 1MB)

'=== gzip estimate for a single article page (JS+CSS referenced) ==='
$page = Get-PageAssets '/2025/11/riddle-joker'
$all = @([regex]::Matches($html, '(?:src|href)="(/_nuxt/[^"]+\.(?:js|css))"') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
$items = @()
$raw = 0; $gz = 0
foreach ($a in $all) {
	$af = Join-Path $p $a.TrimStart('/')
	if (Test-Path -LiteralPath $af) {
		$len = (Get-Item -LiteralPath $af).Length
		$bytes = [System.IO.File]::ReadAllBytes($af)
		$ms = New-Object System.IO.MemoryStream
		$gzStream = New-Object System.IO.Compression.GZipStream($ms, [System.IO.Compression.CompressionMode]::Compress)
		$gzStream.Write($bytes, 0, $bytes.Length)
		$gzStream.Close()
		$gzLen = $ms.ToArray().Length
		$ms.Close()
		$raw += $len; $gz += $gzLen
		$items += [PSCustomObject]@{ KB = [math]::Round($len / 1KB, 1); GzKB = [math]::Round($gzLen / 1KB, 1); Name = Split-Path $a -Leaf }
	}
}
"  files {0} / raw {1:N1} KB / gzip {2:N1} KB" -f $all.Count, ($raw / 1KB), ($gz / 1KB)
'=== top 15 preloaded assets on an article page ==='
$items | Sort-Object KB -Descending | Select-Object -First 15 | Format-Table -AutoSize
"  sqlite/studio in preload list: $([bool]($all -match 'sqlite3|studio'))"
