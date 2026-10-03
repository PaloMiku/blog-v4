# Compare head meta between the live Nuxt site and the built Astro output.
# Pure HTTP, no browser: head is static in both, so DOM diffing buys nothing here.
# Output is a table of per-page, per-field deltas.
#
# KNOWN INTENTIONAL DIFFERENCES
#   Pass -Allow with entries of the form "<path>:<field>" to mark a delta as
#   accepted. Each one below is a case where the ASTRO side is strictly more
#   complete and the live side is simply missing the tag -- reproducing the live
#   behaviour would mean reproducing a defect, so they are pinned, not "fixed".
#
#     og:image        The live site omits it on 5 pages; Astro emits the site
#                     avatar. A missing og:image is a genuine social-card defect.
#     description     The live site emits no meta description on /about, /drive,
#                     /games/* and /previews/*.
#     og:description  Same pages, and on the live site the value is literally
#                     the string "true" (a Nuxt-side boolean that got
#                     stringified into the tag). Astro emits the real
#                     description. Matching "true" here would be absurd.
#
# Anything NOT in the allow list is a real difference and fails the run --
# including a delta in the opposite direction, e.g. robots going from
# "noindex, nofollow" to "index, follow" (that one was a genuine bug, fixed in
# src/lib/noindex-paths.ts).
param(
	[Parameter(Mandatory = $true)][string]$Remote,
	[Parameter(Mandatory = $true)][string]$Dist,
	[string[]]$Paths = @('/', '/archive', '/2025/10/misskey-fediverse-deploy', '/link', '/about', '/drive', '/games/galgames/clannad', '/previews/example'),
	[string[]]$Allow = @(
		'/archive:og:image',
		'/link:og:image',
		'/about:og:image',
		'/drive:og:image',
		'/previews/example:og:image',
		'/about:description',
		'/about:og:description',
		'/drive:description',
		'/drive:og:description',
		'/games/galgames/clannad:description',
		'/games/galgames/clannad:og:description',
		'/previews/example:description',
		'/previews/example:og:description'
	)
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

# Fields to pull. Order matters only for readability.
$Fields = @(
	'title', 'description', 'keywords', 'author', 'generator',
	'og:title', 'og:description', 'og:image', 'og:type', 'og:url', 'og:site_name', 'og:locale',
	'twitter:card', 'theme-color', 'robots',
	'article:published_time', 'article:modified_time',
	'canonical'
)

function Get-Head {
	param([string]$Html)
	$head = $Html
	if ($Html -match '(?is)<head[^>]*>(.*?)</head>') { $head = $Matches[1] }

	$out = [ordered]@{}
	# <title>
	if ($head -match '(?is)<title[^>]*>(.*?)</title>') { $out['title'] = $Matches[1].Trim() } else { $out['title'] = $null }

	foreach ($f in $Fields) {
		if ($f -eq 'title') { continue }
		if ($f -eq 'canonical') {
			$pat = '(?is)<link[^>]+rel=["'']canonical["''][^>]*>'
			if ($head -match $pat) {
				$m = [regex]::Match($Matches[0], '(?i)href=["'']([^"'']+)["'']')
				$out['canonical'] = if ($m.Success) { $m.Groups[1].Value } else { $null }
			}
			else { $out['canonical'] = $null }
			continue
		}
		# meta name= or property=
		$pat = '(?is)<meta[^>]+(?:name|property)=["'']' + [regex]::Escape($f) + '["''][^>]*>'
		if ($head -match $pat) {
			$m = [regex]::Match($Matches[0], '(?i)content=["'']([^"'']*)["'']')
			$out[$f] = if ($m.Success) { $m.Groups[1].Value } else { $null }
		}
		else { $out[$f] = $null }
	}
	return $out
}

$totalDiff = 0
$knownCount = 0
$rows = @()

foreach ($p in $Paths) {
	$rel = $p.TrimEnd('/')
	$localFile = Join-Path $Dist ($rel.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar))
	if ($rel -eq '') { $localFile = Join-Path $Dist 'index.html' }
	else { $localFile = Join-Path $localFile 'index.html' }
	if (-not (Test-Path $localFile)) { $localFile = Join-Path $Dist ($rel.TrimStart('/') + '.html') }

	if (-not (Test-Path $localFile)) {
		Write-Host "SKIP $p : no local build file"
		continue
	}

	$remoteUrl = $Remote.TrimEnd('/') + $p
	# Decode the remote bytes as UTF-8 explicitly.
	# Invoke-WebRequest hands back a string that was decoded with the console's
	# ANSI code page, so every Chinese char became mojibake and *every* title /
	# description / author compared unequal. Half the "differences" in the first
	# run were this bug, not a real difference. Byte-level fetch + explicit
	# UTF-8 is the only way both sides land in the same encoding.
	$remoteHtml = $null
	try {
		$client = [Net.Http.HttpClient]::new()
		$bytes = $client.GetByteArrayAsync($remoteUrl).Result
		$remoteHtml = [Text.Encoding]::UTF8.GetString($bytes)
		$client.Dispose()
	}
	catch {
		Write-Host "SKIP $p : remote fetch failed ($($_.Exception.Message))"
		continue
	}
	$localHtml = [IO.File]::ReadAllText($localFile, [Text.Encoding]::UTF8)

	$r = Get-Head $remoteHtml
	$l = Get-Head $localHtml

	$pd = @()
	$known = @()
	foreach ($f in $Fields) {
		$rv = $r[$f]
		$lv = $l[$f]
		if ($rv -eq $lv) { continue }
		$key = "$p`:$f"
		if ($Allow -contains $key) { $known += $key } else { $pd += $f }
	}
	$totalDiff += $pd.Count
	$knownCount += $known.Count
	$rows += [pscustomobject]@{ Path = $p; DiffCount = $pd.Count; KnownCount = $known.Count; Fields = ($pd -join ', ') }

	Write-Host ""
	Write-Host "=== $p ==="
	if ($pd.Count -eq 0 -and $known.Count -eq 0) {
		Write-Host "  identical"
	}
	else {
		foreach ($f in $pd) {
			Write-Host ("  {0}" -f $f)
			Write-Host ("    nuxt : {0}" -f $r[$f])
			Write-Host ("    astro: {0}" -f $l[$f])
		}
		if ($known.Count -gt 0) {
			Write-Host ("  [known & accepted] {0}" -f ($known -join ', '))
		}
	}
}

Write-Host ""
Write-Host "================ summary ================"
foreach ($row in $rows) {
	$mark = if ($row.DiffCount -eq 0) { if ($row.KnownCount -gt 0) { 'OK~ ' } else { 'OK  ' } } else { 'DIFF' }
	$suffix = if ($row.KnownCount -gt 0) { "  (+$($row.KnownCount) accepted)" } else { '' }
	Write-Host ("  {0} {1,-45} {2}{3}" -f $mark, $row.Path, $row.Fields, $suffix)
}
Write-Host ""
Write-Host "unaccepted field mismatches: $totalDiff"
Write-Host "accepted differences (Astro is more complete): $knownCount"
if ($totalDiff -gt 0) { exit 1 } else { exit 0 }
