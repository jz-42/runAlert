$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

Write-Host "runAlert Windows beta build"
Write-Host "Repo: $RepoRoot"

foreach ($cmd in @("node", "npm")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "$cmd is required before building the Windows beta."
  }
}

Write-Host ""
Write-Host "Installing root dependencies..."
& npm ci
if ($LASTEXITCODE -ne 0) {
  throw "npm ci failed."
}

Write-Host ""
Write-Host "Installing dashboard dependencies..."
& npm --prefix dashboard ci
if ($LASTEXITCODE -ne 0) {
  throw "npm --prefix dashboard ci failed."
}

Write-Host ""
Write-Host "Packing Windows installer..."
& npm run electron:pack:win
if ($LASTEXITCODE -ne 0) {
  throw "npm run electron:pack:win failed."
}

$artifacts = Get-ChildItem -Path (Join-Path $RepoRoot "dist-app") -File -Filter *.exe |
  Sort-Object LastWriteTime -Descending

if (-not $artifacts) {
  throw "Build finished but no Windows .exe was found in dist-app."
}

Write-Host ""
Write-Host "Build complete. Windows artifacts:"
foreach ($artifact in $artifacts) {
  Write-Host " - $($artifact.FullName)"
}

Write-Host ""
Write-Host "Next:"
Write-Host "1. Upload the newest .exe to the GitHub beta release."
Write-Host "2. Set RUNALERT_WINDOWS_EXE_URL in Render."
Write-Host "3. Download from runalert.app/download/windows/exe and smoke test."
