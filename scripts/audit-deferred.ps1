$ErrorActionPreference = 'Stop'

# Final self-audit: sweep the Astro tree for stubs, TODOs and known-deferred
# capabilities, so nothing ships as a silent blank. A marker that is only a
# comment costs nothing, but a component that renders nothing does.

$src = (Resolve-Path '.\src').Path
$rows = @()

$patterns = [ordered]@{
	'TODO/FIXME/XXX'   = '(?m)\b(TODO|FIXME|XXX)\b'
	'unported marker'   = '未移植|尚未迁入|待移植|属其他批次|后续批次'
	'deferred/left empty' = '暂不可用|留空|暂留空|待接|接回|留待'
	'stub keyword'      = '(?i)\bstub\b'
}

foreach ($k in $patterns.Keys) {
	$re = $patterns[$k]
	$hits = @()
	Get-ChildItem $src -Recurse -File -Include *.astro,*.ts | ForEach-Object {
		$lines = [System.IO.File]::ReadAllLines($_.FullName)
		for ($i = 0; $i -lt $lines.Count; $i++) {
			$t = $lines[$i]
			# ignore matches inside block/line comments
			if ($t -match '^\s*(//|\*|/\*|\*)') { continue }
			if ($t -match $re) {
				$hits += [PSCustomObject]@{
					File = $_.FullName.Substring($src.Length + 1)
					Line = $i + 1
					Text = $t.Trim().Substring(0, [Math]::Min(84, $t.Trim().Length))
				}
			}
		}
	}
	$rows += [PSCustomObject]@{ Kind = $k; Hits = $hits }
}

foreach ($r in $rows) {
	Write-Output ''
	Write-Output ('=== ' + $r.Kind + ' : ' + $r.Hits.Count + ' ===')
	$r.Hits | Select-Object -First 12 | ForEach-Object {
		Write-Output ('  ' + $_.File + ':' + $_.Line + '  ' + $_.Text)
	}
	if ($r.Hits.Count -gt 12) { Write-Output ('  ... +' + ($r.Hits.Count - 12) + ' more') }
}

Write-Output ''
Write-Output '=== 组件总量 ==='
foreach ($d in @('content', 'blog', 'widget', 'partial', 'post', 'popover')) {
	$p = Join-Path $src "components/$d"
	if (Test-Path $p) {
		$n = (Get-ChildItem $p -File -Filter *.astro).Count
		Write-Output ('  ' + $d.PadRight(10) + $n)
	}
}
Write-Output ('  layouts   ' + (Get-ChildItem (Join-Path $src 'layouts') -File -Filter *.astro -ErrorAction SilentlyContinue).Count)
Write-Output ('  lib       ' + (Get-ChildItem (Join-Path $src 'lib') -File -ErrorAction SilentlyContinue).Count)
Write-Output ('  loaders   ' + (Get-ChildItem (Join-Path $src 'loaders') -File -ErrorAction SilentlyContinue).Count)
