$name = 'docker desktop'
$dirs = @(
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
  (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs')
)
Write-Output "DIRS: $($dirs -join ' | ')"
$all = Get-ChildItem $dirs -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue
Write-Output "TOTAL LNK: $(($all | Measure-Object).Count)"
$hits = $all | Where-Object { $_.BaseName -like "*$name*" }
Write-Output "HITS:"
$hits | ForEach-Object { Write-Output "  $($_.FullName)" }
