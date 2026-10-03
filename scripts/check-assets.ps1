param(
	[string] $DistDir = (Join-Path $PSScriptRoot '..\dist'),
	[string[]] $Extensions = @(
		'woff2', 'woff', 'ttf', 'otf',
		'png', 'jpg', 'jpeg', 'svg', 'webp', 'ico',
		'xml', 'txt', 'json', 'opml', 'xsl', 'css'
	)
)

$ErrorActionPreference = 'Stop'

# Static-asset integrity gate.
#
# The failure mode this exists for:
#   the site font `public/fonts/LXGWWenKai.woff2` was never copied into the
#   Astro tree. Both `@font-face` rules kept pointing at `/fonts/...`, the
#   build still succeeded (Astro does not verify referenced public/ files),
#   and every single existing gate stayed green -- they only compare text,
#   urls, titles and dates. It was found by hand-scanning the artifact.
#
#   Same shape of bug: a typo'd asset path, a renamed file, a missing copy
#   into public/. All of them produce a build that "looks right" and a site
#   that 404s.
#
# What it checks:
#   every local (root-relative or file-relative) reference to a static asset
#   in the built HTML and CSS -- `src=`, `href=`, and CSS `url()` -- resolves
#   to a file that actually exists inside the dist tree.
#
# External references (https://, //cdn, data:, mailto:, #anchor) are skipped:
# they are not this gate's business.
#
# NOT covered (deliberately, both are stated so nobody assumes otherwise):
#   - `srcset=` candidate lists
#   - `.js` chunks -- not in the $Extensions list above; the bundler owns them
#
# Exit codes: 0 = PASS, 1 = FAIL, 2 = cannot run (missing dist)
#
# NOTE: ASCII-only. Windows PowerShell 5.1 reads a BOM-less .ps1 using the
# system ANSI code page; a non-ASCII comment gets mis-decoded and swallows the
# following newline, which silently skips the next executable statement.

# [System.IO.File]::Exists() returns False for a directory, always. Directory
# checks must use Test-Path -PathType Container.
if (-not (Test-Path -LiteralPath $DistDir -PathType Container)) {
	"ERROR: dist directory not found: $DistDir"
	'RESULT: ERROR - nothing to scan (run the build first)'
	exit 2
}
$root = (Resolve-Path -LiteralPath $DistDir).Path

$extSet = @{}
foreach ($e in $Extensions) { $extSet[$e.TrimStart('.').ToLowerInvariant()] = $true }

# Attribute references in HTML: src="..." / href='...' / src=x.png
$rxAttr = '(?i)(?:src|href)\s*=\s*(?:"([^"]*)"|''([^'']*)''|([^\s>]+))'
# CSS url() references, quoted or bare, in linked CSS and inline <style>.
$rxUrl = '(?i)url\(\s*(?:"([^"]*)"|''([^'']*)''|([^)''"\s]*))\s*\)'
$rxStyleBlock = '(?is)<style[^>]*>(.*?)</style>'

function Resolve-Reference {
	param([string] $Ref, [string] $FromDir, [string] $Root)

	$ref = $Ref.Trim()
	if (-not $ref) { return $null }
	# anchors, inline data, protocol-relative and absolute URLs, non-http schemes
	if ($ref.StartsWith('#')) { return $null }
	if ($ref -match '^(?i)(data|mailto|javascript|tel|blob|about):') { return $null }
	if ($ref.StartsWith('//')) { return $null }
	if ($ref -match '^[a-zA-Z][a-zA-Z0-9+.-]*:') { return $null }
	# fragment and query are not part of the file path
	$path = ($ref -split '[?#]')[0]
	if (-not $path) { return $null }
	try { $path = [System.Uri]::UnescapeDataString($path) } catch { }
	# [System.IO.Path]::GetExtension throws on some legal attribute values
	# (e.g. a bare token that is not a path at all), so match the extension
	# lexically instead.
	if ($path -notmatch '\.([A-Za-z0-9]+)$') { return $null }
	$ext = $Matches[1].ToLowerInvariant()
	if (-not $extSet.ContainsKey($ext)) { return $null }

	if ($path.StartsWith('/')) {
		return @{ kind = 'root'; rel = $path.TrimStart('/'); candidates = @((Join-Path $Root $path.TrimStart('/'))) }
	}
	# File-relative: try the referring file's own directory first, then the
	# site root (some pipelines emit a relative href meaning root-relative).
	return @{
		kind       = 'relative'
		rel        = $path
		candidates = @(
			(Join-Path $FromDir ($path -replace '/', '\')),
			(Join-Path $Root ($path -replace '/', '\'))
		)
	}
}

$scanned = 0
$checked = 0
# missing path (lowercased full path) -> list of referrers
$missing = @{}

function Add-Ref {
	param([string] $Ref, [string] $FromDir, [string] $Rel)

	$info = Resolve-Reference -Ref $Ref -FromDir $FromDir -Root $root
	if (-not $info) { return }
	$script:checked++
	$hit = $null
	foreach ($cand in $info.candidates) {
		if ([System.IO.File]::Exists($cand)) { $hit = $cand; break }
	}
	if ($hit) { return }
	$key = ($info.candidates[0]).ToLowerInvariant()
	if (-not $missing.ContainsKey($key)) {
		$missing[$key] = @{ rel = $info.rel; refs = @() }
	}
	$missing[$key].refs += $Rel
}

foreach ($f in Get-ChildItem $root -Recurse -File) {
	$name = $f.Name.ToLowerInvariant()
	$isHtml = $name.EndsWith('.html') -or $name.EndsWith('.htm')
	$isCss = $name.EndsWith('.css')
	if (-not ($isHtml -or $isCss)) { continue }
	$scanned++
	$fromDir = $f.DirectoryName
	$relToRoot = $f.FullName.Substring($root.Length + 1) -replace '\\', '/'

	$text = [System.IO.File]::ReadAllText($f.FullName)

	foreach ($m in [regex]::Matches($text, $rxAttr)) {
		$v = if ($m.Groups[1].Success) { $m.Groups[1].Value }
		elseif ($m.Groups[2].Success) { $m.Groups[2].Value }
		else { $m.Groups[3].Value }
		Add-Ref -Ref $v -FromDir $fromDir -Rel $relToRoot
	}
	foreach ($m in [regex]::Matches($text, $rxUrl)) {
		$v = if ($m.Groups[1].Success) { $m.Groups[1].Value }
		elseif ($m.Groups[2].Success) { $m.Groups[2].Value }
		else { $m.Groups[3].Value }
		Add-Ref -Ref $v -FromDir $fromDir -Rel $relToRoot
	}
	# Astro inlines some component styles into the page; those carry url()
	# references the two passes above would never see.
	if ($isHtml) {
		foreach ($sm in [regex]::Matches($text, $rxStyleBlock)) {
			foreach ($m in [regex]::Matches($sm.Groups[1].Value, $rxUrl)) {
				$v = if ($m.Groups[1].Success) { $m.Groups[1].Value }
				elseif ($m.Groups[2].Success) { $m.Groups[2].Value }
				else { $m.Groups[3].Value }
				Add-Ref -Ref $v -FromDir $fromDir -Rel "$relToRoot (inline <style>)"
			}
		}
	}
}

'--- static asset references ---'
"  scanned $scanned html/css file(s) under $root"
"  checked $checked local asset reference(s)"

if ($missing.Count -eq 0) {
	'  OK    every local asset reference resolves inside dist'
}
else {
	'  --- MISSING ---'
	foreach ($k in ($missing.Keys | Sort-Object)) {
		$e = $missing[$k]
		"  MISS  /$($e.rel -replace '\\','/')"
		$shown = 0
		foreach ($r in ($e.refs | Sort-Object -Unique)) {
			if ($shown -ge 4) { "          ... +$($e.refs.Count - $shown) more referrer(s)"; break }
			"          <- $r"
			$shown++
		}
	}
}

''
if ($missing.Count -eq 0) {
	'RESULT: PASS - no dangling local asset reference'
	exit 0
}
"RESULT: FAIL - $($missing.Count) referenced local asset(s) missing from dist"
exit 1
