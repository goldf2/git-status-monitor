param(
  [Parameter(Mandatory = $true)]
  [string]$Version
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DistDirectory = Join-Path $ProjectRoot 'dist'
$Installer = Join-Path $DistDirectory "GitFinder-$Version-x64-win-setup.exe"
$Zip = Join-Path $DistDirectory "GitFinder-$Version-x64-win.zip"
$UnpackedExe = Join-Path $DistDirectory 'win-unpacked\GitFinder.exe'
$InstallDirectory = Join-Path $env:LOCALAPPDATA 'Programs\GitFinder'
$InstalledExe = Join-Path $InstallDirectory 'GitFinder.exe'
$Uninstaller = Join-Path $InstallDirectory 'Uninstall GitFinder.exe'
$ReportPath = Join-Path $DistDirectory 'windows-install-verification.json'
$Processes = @()
$Installed = $false

function Assert-ApplicationStarts([string]$Executable, [string]$Label) {
  $Process = Start-Process -FilePath $Executable -ArgumentList '--disable-gpu' -PassThru
  $script:Processes += $Process
  Start-Sleep -Seconds 8
  if ($Process.HasExited) {
    throw "$Label exited during startup with code $($Process.ExitCode)"
  }
  & taskkill.exe /PID $Process.Id /T /F | Out-Null
  if ($LASTEXITCODE -ne 0 -and -not $Process.HasExited) {
    Stop-Process -Id $Process.Id -Force
  }
  $Process.WaitForExit()
}

try {
  foreach ($Artifact in @($Installer, $Zip, $UnpackedExe)) {
    if (-not (Test-Path -LiteralPath $Artifact -PathType Leaf)) {
      throw "Missing Windows artifact: $Artifact"
    }
  }

  $InstallerHash = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant()
  $ZipHash = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash.ToLowerInvariant()
  Assert-ApplicationStarts $UnpackedExe 'Unpacked GitFinder'

  $Install = Start-Process -FilePath $Installer -ArgumentList '/S' -Wait -PassThru
  if ($Install.ExitCode -ne 0) { throw "NSIS installer failed with code $($Install.ExitCode)" }
  $Installed = $true
  if (-not (Test-Path -LiteralPath $InstalledExe -PathType Leaf)) {
    throw "Installed executable not found: $InstalledExe"
  }
  Assert-ApplicationStarts $InstalledExe 'Installed GitFinder'

  if (-not (Test-Path -LiteralPath $Uninstaller -PathType Leaf)) {
    throw "Uninstaller not found: $Uninstaller"
  }
  $Uninstall = Start-Process -FilePath $Uninstaller -ArgumentList '/S' -Wait -PassThru
  if ($Uninstall.ExitCode -ne 0) { throw "NSIS uninstaller failed with code $($Uninstall.ExitCode)" }
  $Installed = $false
  Start-Sleep -Seconds 2
  if (Test-Path -LiteralPath $InstalledExe) { throw 'Installed executable remains after uninstall' }

  $Signature = (Get-AuthenticodeSignature -LiteralPath $Installer).Status.ToString()
  $Report = [ordered]@{
    schemaVersion = 1
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    version = $Version
    platform = 'windows'
    architecture = 'x64'
    installer = [ordered]@{ file = (Split-Path -Leaf $Installer); sha256 = $InstallerHash }
    zip = [ordered]@{ file = (Split-Path -Leaf $Zip); sha256 = $ZipHash }
    signatureStatus = $Signature
    unsignedTestBuild = ($Signature -ne 'Valid')
    unpackedStartup = $true
    installedStartup = $true
    installVerified = $true
    uninstallVerified = $true
  }
  $Report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ReportPath -Encoding utf8
  Write-Host "Windows package acceptance passed: $ReportPath"
} finally {
  foreach ($Process in $Processes) {
    if ($null -ne $Process -and -not $Process.HasExited) {
      & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null
      if ($LASTEXITCODE -ne 0 -and -not $Process.HasExited) {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
      }
    }
  }
  if ($Installed -and (Test-Path -LiteralPath $Uninstaller)) {
    Start-Process -FilePath $Uninstaller -ArgumentList '/S' -Wait -ErrorAction SilentlyContinue
  }
}
