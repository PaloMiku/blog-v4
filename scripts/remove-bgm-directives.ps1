$ErrorActionPreference = 'Stop'

# Remove the dead `::bgm-*` MDC directives from PUBLISHED articles only.
#
# The Bangumi feature was removed on 2026-09-30; the components no longer exist,
# so these directives render as literal text on the live site.
# src/content/previews/bangumi-components.mdx is deliberately kept (CLAUDE.md
# records it as a restoration asset) and is handled separately.
#
# A bgm block looks like:
#     ::bgm-card
#     ---
#     id: 219200
#     compact: true
#     ---
#     ::
# with the opening colons and the closing :: sharing the same count.
#
# NOTE: ASCII-only (Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI).
# NOTE: the content root moved to src/content and the extension to .mdx when
# Astro took over the repo root. This one-off was already applied, so the run
# below is expected to remove 0 blocks -- it is kept for re-application.

$published = @(
	'src/content/posts/2024/03/takagi.mdx',
	'src/content/posts/2025/05/clannad-zh-linux.mdx',
	'src/content/posts/2025/05/gal-up.mdx',
	'src/content/posts/2025/05/koichoco-psp.mdx',
	'src/content/posts/2025/10/nukitashi-gv-end.mdx'
)

$totalRemoved = 0

foreach ($rel in $published) {
	$path = (Resolve-Path $rel).Path
	$lines = [System.IO.File]::ReadAllLines($path)
	$out = New-Object System.Collections.ArrayList
	$removed = 0
	$depth = 0
	$openColons = 0

	for ($i = 0; $i -lt $lines.Count; $i++) {
		$t = $lines[$i].TrimEnd()

		if ($depth -eq 0) {
			if ($t -match '^\s*(:{2,})bgm-[a-z-]+\s*$') {
				$openColons = $matches[1].Length
				$depth = 1
				$removed++
				continue
			}
		}
		else {
			# inside the block: swallow everything, watch for the matching close
			if ($t -match '^\s*:{' + $openColons + '}\s*$') {
				$depth = 0
				continue
			}
			continue
		}

		[void]$out.Add($lines[$i])
	}

	if ($removed -gt 0) {
		# collapse any run of 3+ blank lines the removal may have left behind
		$text = ($out -join "`r`n")
		$text = $text -replace '(\r?\n[ \t]*){4,}', "`r`n`r`n`r`n"
		# keep a single trailing newline
		$text = $text.TrimEnd() + "`r`n"
		[System.IO.File]::WriteAllText($path, $text)
		Write-Output ('  ' + $rel + '  removed ' + $removed + ' block(s)')
		$totalRemoved += $removed
	}
	else {
		Write-Output ('  ' + $rel + '  no bgm block found')
	}
}

Write-Output ''
Write-Output ('total blocks removed from published articles: ' + $totalRemoved)

# verify none remain outside the preview page
$left = @()
Get-ChildItem content -Recurse -File -Filter *.md | ForEach-Object {
	if ($_.FullName -like '*bangumi-components.md') { return }
	$l = [System.IO.File]::ReadAllLines($_.FullName)
	for ($i = 0; $i -lt $l.Count; $i++) {
		if ($l[$i] -match '^\s*:{2,}bgm-') { $left += ($_.Name + ':' + ($i + 1)) }
	}
}
Write-Output ('remaining bgm directives outside the preview page: ' + $left.Count)
$left | ForEach-Object { '    ' + $_ }
