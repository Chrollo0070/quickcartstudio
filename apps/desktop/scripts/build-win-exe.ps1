param(
  [ValidateSet('all', 'nsis', 'portable')]
  [string]$Target = 'all'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$DesktopDir = Join-Path $RepoRoot 'apps\desktop'

Write-Host '==> 1/4 Building QuickCart shared & Next.js standalone server...' -ForegroundColor Cyan
Push-Location $RepoRoot
try {
  npm install
  npm run build
} finally {
  Pop-Location
}

Write-Host '==> 2/4 Installing Electron desktop builder dependencies...' -ForegroundColor Cyan
Push-Location $DesktopDir
try {
  npm install
  Write-Host '==> 3/4 Generating Windows icons & staging standalone runtime...' -ForegroundColor Cyan
  node scripts/generate-icons.mjs
  npm run prepare:standalone

  Write-Host "==> 4/4 Packaging Windows .exe ($Target)..." -ForegroundColor Cyan
  if ($Target -eq 'nsis') {
    npm run dist:win
  } elseif ($Target -eq 'portable') {
    npm run dist:portable
  } else {
    npm run dist:win
  }

  Write-Host ''
  Write-Host 'Build complete! Output executables:' -ForegroundColor Green
  Get-ChildItem -Path (Join-Path $DesktopDir 'release') -Filter '*.exe' | ForEach-Object {
    $mb = [Math]::Round($_.Length / 1MB, 1)
    Write-Host ("  - {0} ({1} MB)" -f $_.FullName, $mb)
  }
} finally {
  Pop-Location
}
