$ErrorActionPreference = 'Stop'

# Every source frontmatter `date` must render as the SAME INSTANT in the page's
# <time datetime="...">.
#
# The previous version compared the two as STRINGS and reported 40/40 mismatches
# (a 100% failure rate, which is itself the signal: that is not 40 defects, it is
# an incompatible comparison). Source is a bare wall clock, e.g.
#     date: 2025-05-26 17:00:00
# the product is UTC ISO, e.g.
#     datetime="2025-05-26T09:00:00Z"
# Same moment, 8 hours apart in notation. A string compare can never succeed.
#
# Why local time is the right reading of the source: the content pipeline parses
# that non-ISO string with the JS Date constructor, which interprets it in the
# BUILD MACHINE's timezone, then serializes to UTC. So this gate must interpret
# it the same way -- and that makes the verdict valid only when the runner's
# timezone matches the build's. The offset in use is printed in the summary so a
# mismatch is diagnosable instead of mysterious. This is the same class of
# constraint as the font baseline in docs/astro-phase1-findings.md 26: the
# baseline's validity rests on a stated premise, not on a check.
#
# NOTE: ASCII-only. Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI.
# NOTE: paths resolve from $PSScriptRoot, not the process CWD (findings 85.6).

$siteRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$contentRoot = Join-Path $siteRoot 'src/content'
$dist = Join-Path $siteRoot 'dist'
$inv = [System.Globalization.CultureInfo]::InvariantCulture

$checked = 0
$mismatches = New-Object System.Collections.ArrayList
$skipped = New-Object System.Collections.ArrayList

foreach ($f in (Get-ChildItem $contentRoot -Recurse -File -Filter *.mdx)) {
	# mirror content.config.ts generateId(): strip extension, strip /posts, strip index
	# NOTE: Substring() on the content root leaves a LEADING slash, so it must be
	# trimmed before the 'posts/' test or every path comes out wrong.
	$rel = $f.FullName.Substring($contentRoot.Length).Replace('\', '/').TrimStart('/')
	$raw = [System.IO.File]::ReadAllText($f.FullName)
	$relId = $rel -replace '\.mdx$', ''
	if ($relId.StartsWith('posts/')) { $relId = $relId.Substring('posts/'.Length) }
	$relId = $relId -replace '(^|/)index$', '$1'
	$relId = $relId.TrimEnd('/')
	if ($relId -eq '') { [void]$skipped.Add($rel); continue }

	$page = Join-Path $dist ($relId + '/index.html')
	if (-not (Test-Path -LiteralPath $page)) { [void]$skipped.Add("$rel (no page)"); continue }

	$srcDate = ([regex]::Match($raw, '(?m)^date:\s*(.+)$')).Groups[1].Value.Trim()
	if ($srcDate -eq '') { [void]$skipped.Add("$rel (no date)"); continue }

	$html = [System.IO.File]::ReadAllText($page)
	$mm = [regex]::Match($html, 'datetime="([^"]*)"')
	if (-not $mm.Success) { [void]$skipped.Add("$rel (no <time>)"); continue }

	$checked++
	$outDate = $mm.Groups[1].Value

	try {
		$srcInstant = [datetime]::Parse($srcDate, $inv).ToUniversalTime()
	}
	catch {
		[void]$mismatches.Add("$rel  unparseable source date: $srcDate")
		continue
	}

	# The product is UTC ISO with a trailing Z. AssumeUniversal + AdjustToUniversal
	# is what makes '...Z' mean UTC rather than "local time that happens to end in Z".
	$outInstant = [datetime]::ParseExact(
		$outDate,
		"yyyy-MM-ddTHH:mm:ss\Z",
		$inv,
		[System.Globalization.DateTimeStyles]::AdjustToUniversal -bor [System.Globalization.DateTimeStyles]::AssumeUniversal
	)

	if ($srcInstant.Ticks -ne $outInstant.Ticks) {
		[void]$mismatches.Add(("$rel  src=" + $srcDate + " (" + $srcInstant.ToString('yyyy-MM-ddTHH:mm:ss\Z') +
				")  out=" + $outDate))
	}
}

$off = [System.TimeZoneInfo]::Local.GetUtcOffset([datetime]::Now)
Write-Output ("pages with a source date and a rendered <time> : " + $checked)
Write-Output ("mismatches                                     : " + $mismatches.Count)
Write-Output ("skipped                                        : " + $skipped.Count)
Write-Output ("runner UTC offset                              : " + $off)
Write-Output ''
if ($mismatches.Count -gt 0) {
	Write-Output 'mismatches (first 10):'
	foreach ($m in ($mismatches | Select-Object -First 10)) { Write-Output ('  ' + $m) }
	Write-Output ''
	Write-Output 'RESULT: FAIL'
	exit 1
}
Write-Output 'RESULT: PASS - every rendered datetime is the same instant as its source frontmatter date'
exit 0
