$ErrorActionPreference = 'Stop'

# Compare per-page title between the Nuxt baseline and the Astro build.
# NOTE: this script must stay ASCII-only. Windows PowerShell 5.1 reads BOM-less
# .ps1 files as the system ANSI code page, so non-ASCII literals get mangled.
# Chinese titles are therefore compared by prefix/containment, not by exact match.
$siteRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$base = (Resolve-Path (Join-Path $siteRoot 'baseline\nuxt')).Path
$dist = Join-Path $siteRoot 'dist'

function Decode-Entities([string]$s) {
	$s = $s -replace '&#x2F;', '/' -replace '&#47;', '/' -replace '&#x3A;', ':' -replace '&#58;', ':'
	$s = $s -replace '&amp;', '&' -replace '&lt;', '<' -replace '&gt;', '>' -replace '&quot;', '"'
	$s = $s -replace '&#(\d+);', { param($m) [char][int]$m.Groups[1].Value }
	return $s
}

function Get-Title([string]$html) {
	if ($html -match '<title>([^<]*)</title>') { return (Decode-Entities $matches[1]).Trim() }
	return '(no-title)'
}

$rows = @()
Get-ChildItem $dist -Recurse -File -Filter *.html |
	Where-Object { $_.Name -notin @('200.html', '404.html') } |
	ForEach-Object {
		$url = $_.FullName.Substring($dist.Length).Replace('\', '/') -replace '/index\.html$', '/' -replace '\.html$', ''
		$astroTitle = Get-Title ([System.IO.File]::ReadAllText($_.FullName))

		$nb = if ($url -eq '/') { Join-Path $base 'index.html' } else { Join-Path $base ($url.TrimStart('/') + '/index.html') }
		$nuxtTitle = if (Test-Path -LiteralPath $nb -PathType Leaf) { Get-Title ([System.IO.File]::ReadAllText($nb)) } else { '(missing)' }

		# Nuxt appends the site title via titleTemplate ("%s | SiteTitle").
		# Compare the article-title part only: nuxt must start with the astro title.
		$ok = $nuxtTitle.StartsWith($astroTitle)

		$rows += [PSCustomObject]@{
			Url = $url; Nuxt = $nuxtTitle; Astro = $astroTitle
			Match = if ($ok) { 'OK' } else { 'DIFF' }
		}
	}

$rows = $rows | Sort-Object Url
$diff = @($rows | Where-Object Match -eq 'DIFF')

"pages compared : $($rows.Count)"
"title match    : $(@($rows | Where-Object Match -eq 'OK').Count)"
"title diff     : $($diff.Count)"
''
if ($diff.Count -gt 0) {
	'### TITLE DIFFERENCES'
	$diff | ForEach-Object { "  $($_.Url)`n    nuxt : $($_.Nuxt)`n    astro: $($_.Astro)" }
}
else { 'RESULT: PASS - every Astro title is the leading segment of the Nuxt title' }

$rows | Export-Csv '.\scripts\title-parity.csv' -NoTypeInformation -Encoding UTF8
'wrote .\scripts\title-parity.csv'
