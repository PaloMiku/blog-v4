$ErrorActionPreference = 'Stop'

# Quantify whether the Nuxt baseline's image pipeline actually did anything.
# Finding so far: srcset entries for remote images all point at the SAME url
# (densities [1, 1.5, 2] with no ipx proxying), so they add bytes, not pixels.
# If that holds site-wide, migrating to astro:assets would be a regression,
# not a parity fix.

$siteRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$base = (Resolve-Path (Join-Path $siteRoot 'baseline\nuxt')).Path

$totalImg = 0
$withSrcset = 0
$degenerate = 0
$useful = 0
$ipx = 0
$samples = New-Object System.Collections.ArrayList

foreach ($f in (Get-ChildItem $base -Recurse -File -Filter *.html)) {
	$html = [System.IO.File]::ReadAllText($f.FullName)
	$imgs = [regex]::Matches($html, '<img\b[^>]*>')
	foreach ($im in $imgs) {
		$tag = $im.Value
		$totalImg++
		if ($tag.Contains('_ipx')) { $ipx++ }
		if (-not $tag.Contains('srcset=')) { continue }
		$withSrcset++
		$set = [regex]::Match($tag, 'srcset="([^"]+)"').Groups[1].Value
		$parts = $set.Split(',')
		$urls = @()
		foreach ($p in $parts) {
			$u = ($p -split '\s+')[0]
			if ($u -and ($urls -notcontains $u)) { $urls += $u }
		}
		if ($urls.Count -le 1) {
			$degenerate++
		}
		else {
			$useful++
			if ($samples.Count -lt 5) { [void]$samples.Add(($f.Name + ' -> ' + $urls.Count + ' distinct candidates')) }
		}
	}
}

Write-Output ('img tags total      : ' + $totalImg)
Write-Output ('  with srcset       : ' + $withSrcset)
Write-Output ('  srcset DEGENERATE : ' + $degenerate)
Write-Output ('  srcset USEFUL     : ' + $useful)
Write-Output ('  proxied via _ipx  : ' + $ipx)
Write-Output ''

if ($samples.Count -gt 0) {
	Write-Output 'useful srcset samples:'
	foreach ($s in $samples) { Write-Output ('  ' + $s) }
}
else {
	Write-Output 'no genuinely useful srcset anywhere in the baseline'
}
Write-Output ''

if (($useful -eq 0) -and ($ipx -eq 0)) {
	Write-Output 'CONCLUSION: the Nuxt image pipeline produced no real optimisation.'
	Write-Output '            A bare <img> is functionally equivalent; astro:assets would'
	Write-Output '            download every remote image at build time for no parity gain.'
}
else {
	Write-Output 'CONCLUSION: the baseline does optimise images; astro:assets is worth scoping.'
}
