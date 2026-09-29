#requires -Version 5.1
<#
.SYNOPSIS
  opencode-personal installer (fork). Installs the command `opencode-personal`
  into %USERPROFILE%\.opencode-personal\bin.
.NOTES
  Coexistence: never touches an existing upstream install (~\.opencode\**,
  ~\.local\bin\opencode*). Appends only its own directory to the USER PATH.
#>
param(
    [string]$Version = "",   # pin a release, e.g. -Version 1.14.48-p.1
    [string]$Binary = ""     # install from a local binary instead of downloading
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo       = "ozgurulukir/opencode-personal"
$Command    = "opencode-personal"
$InstallDir = Join-Path $HOME ".opencode-personal\bin"

# --- arch ---
$arch = if ("$env:PROCESSOR_ARCHITECTURE" -eq "ARM64") { "arm64" } else { "x64" }

# --- AVX2 baseline detection (mirrors install.sh; IsProcessorFeaturePresent(40)) ---
$needsBaseline = $false
if ($arch -eq "x64") {
    try {
        $sig = '[DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);'
        $k32 = Add-Type -MemberDefinition $sig -Name Kernel32Avx2Personal -Namespace Win32 -PassThru
        if (-not $k32::IsProcessorFeaturePresent(40)) { $needsBaseline = $true }
    } catch { $needsBaseline = $false }
}
$target = "windows-$arch"
if ($needsBaseline) { $target = "$target-baseline" }

# --- resolve what to install ---
if ($Binary) {
    if (-not (Test-Path -LiteralPath $Binary)) { throw "Binary not found at $Binary" }
    $Version = "local"
} else {
    if (-not $Version) {
        $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest"
        $Version = $rel.tag_name.TrimStart("v")
    }
    $Version = $Version.TrimStart("v")
}

Write-Host "Installing $Command $Version ($target)..."

# Distinct tmp dir (never collides with an upstream installer's temp files)
$tmp = Join-Path ([IO.Path]::GetTempPath()) "opencode-personal-install-$PID"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

try {
    if ($Binary) {
        Copy-Item -LiteralPath $Binary -Destination (Join-Path $InstallDir "$Command.exe") -Force
    } else {
        $asset = "opencode-$target.zip"   # asset names keep the upstream 'opencode' prefix
        $url   = "https://github.com/$Repo/releases/download/v$Version/$asset"
        $zip   = Join-Path $tmp $asset
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
        $x = Join-Path $tmp "x"
        Expand-Archive -Path $zip -DestinationPath $x -Force
        # Rename the compiled binary to the fork command name, then copy ALL archive
        # contents (binary + opentui.dll) - the binary needs the DLL next to it.
        Move-Item -LiteralPath (Join-Path $x "opencode.exe") -Destination (Join-Path $x "$Command.exe") -Force
        Copy-Item -Path (Join-Path $x "*") -Destination $InstallDir -Force
    }
    Write-Host "Installed to $InstallDir"
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# --- user PATH (append-only; never removes or reorders existing entries) ---
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($userPath -split ";") -notcontains $InstallDir) {
    $newPath = if ($userPath) { "$userPath;$InstallDir" } else { $InstallDir }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    $env:Path = "$env:Path;$InstallDir"
    Write-Host "Added $InstallDir to your user PATH. Restart your terminal for it to take effect."
}

Write-Host ""
Write-Host "$Command $Version installed. Run '$Command' in a project directory to start."
Write-Host "Installs alongside any existing upstream 'opencode' - this script never touches ~\.opencode or the upstream binary."
