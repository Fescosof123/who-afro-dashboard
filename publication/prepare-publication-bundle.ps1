Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$bundleRoot = Join-Path $scriptDir "bundle"
$appBundleRoot = Join-Path $bundleRoot "dashboard-app"

if (Test-Path $bundleRoot) {
    Remove-Item -Recurse -Force $bundleRoot
}

New-Item -ItemType Directory -Force -Path $appBundleRoot | Out-Null

$pathsToInclude = @(
    "package.json",
    "package-lock.json",
    "server.js",
    ".env.example",
    "publish-check.ps1",
    "RELEASE_CHECKLIST.md",
    "README.md",
    "AGENT_HANDOFF_GUIDE.md",
    "public/index.html",
    "public/app.js",
    "public/styles.css",
    "data/README-offline-data.md",
    "tests/dashboard-api-smoke.test.js"
)

foreach ($relativePath in $pathsToInclude) {
    $sourcePath = Join-Path $projectRoot $relativePath
    if (-not (Test-Path $sourcePath)) {
        throw "Missing required path: $relativePath"
    }

    $destinationPath = Join-Path $appBundleRoot $relativePath
    $destinationDir = Split-Path -Parent $destinationPath
    New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null

    Copy-Item -Path $sourcePath -Destination $destinationPath -Force
}

$manifestSource = Join-Path $scriptDir "FILES_FOR_PUBLICATION.csv"
$guideSource = Join-Path $scriptDir "PUBLIC_DEPLOYMENT_GUIDE.rtf"
Copy-Item -Path $manifestSource -Destination (Join-Path $bundleRoot "FILES_FOR_PUBLICATION.csv") -Force
Copy-Item -Path $guideSource -Destination (Join-Path $bundleRoot "PUBLIC_DEPLOYMENT_GUIDE.rtf") -Force

Write-Host "Publication bundle created at: $bundleRoot" -ForegroundColor Green
Write-Host "Bundle root contents:" -ForegroundColor Cyan
Get-ChildItem -Path $bundleRoot | Select-Object Name, Mode, LastWriteTime | Format-Table -AutoSize
