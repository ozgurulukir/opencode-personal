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

# --- optional auth (GH_TOKEN / GITHUB_TOKEN, same names gh CLI uses) ---
# Required while the repo is private (anonymous API calls get 404); harmless
# and rate-limit-friendly once public. Never forwarded to the redirect target -
# Invoke-WebRequest drops the Authorization header on cross-host redirects.
$token = $env:GH_TOKEN
if (-not $token) { $token = $env:GITHUB_TOKEN }
$authHeaders = @{}
if ($token) { $authHeaders["Authorization"] = "Bearer $token" }

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
        $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers $authHeaders
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
        $zip   = Join-Path $tmp $asset
        if ($token) {
            # github.com/.../releases/download ignores API tokens on private repos (404):
            # pull the asset through the octet-stream asset API instead.
            $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/tags/v$Version" -Headers $authHeaders
            $assetId = $rel.assets | Where-Object name -eq $asset | Select-Object -First 1 -ExpandProperty id
            if (-not $assetId) { throw "Asset '$asset' not found in release v$Version of $Repo" }
            Invoke-WebRequest -Uri "https://api.github.com/repos/$Repo/releases/assets/$assetId" -OutFile $zip -UseBasicParsing -Headers ($authHeaders + @{ Accept = "application/octet-stream" })
        } else {
            $url = "https://github.com/$Repo/releases/download/v$Version/$asset"
            Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
        }
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

# --- user PATH (append-only; never removes, reorders, or rewrites existing entries) ---
# Round-trip the RAW registry value instead of [Environment]::Get/SetEnvironmentVariable:
# GetEnvironmentVariable("Path","User") expands REG_EXPAND_SZ %vars% using THIS process's
# environment (wrong whenever USERPROFILE is redirected, e.g. under verify-isolation.ps1),
# and SetEnvironmentVariable rewrites the whole value as REG_SZ - degrading the value kind
# and freezing %-entries to this machine's literal paths. Reading raw and writing back
# with the original kind keeps every existing entry byte-identical.
$envKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
try {
    $rawPath = $envKey.GetValue("Path", $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $kind = if ($null -ne $rawPath) { $envKey.GetValueKind("Path") } else { [Microsoft.Win32.RegistryValueKind]::String }
    $appendable = $kind -eq [Microsoft.Win32.RegistryValueKind]::String -or $kind -eq [Microsoft.Win32.RegistryValueKind]::ExpandString
    if (-not $appendable) {
        # Never risk mangling an exotic value kind - install succeeds, PATH stays manual.
        Write-Warning "User PATH registry value has unexpected kind '$kind'; add '$InstallDir' to your PATH manually."
    } elseif (($rawPath -split ";") -notcontains $InstallDir) {
        $newPath = if ($rawPath) { "$rawPath;$InstallDir" } else { $InstallDir }
        $envKey.SetValue("Path", $newPath, $kind)
        $env:Path = "$env:Path;$InstallDir"
        Write-Host "Added $InstallDir to your user PATH. Restart your terminal for it to take effect."
        # SetEnvironmentVariable broadcast WM_SETTINGCHANGE for us; keep that behavior.
        try {
            $sig = '[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);'
            $user32 = Add-Type -MemberDefinition $sig -Name User32PathBroadcastPersonal -Namespace Win32 -PassThru
            [UIntPtr]$res = [UIntPtr]::Zero
            $user32::SendMessageTimeout([IntPtr]0xFFFF, 0x001A, [UIntPtr]::Zero, "Environment", 2, 5000, [ref]$res) | Out-Null
        } catch {
            # best-effort: a failed WM_SETTINGCHANGE broadcast must not fail the install
        }
    }
} finally {
    $envKey.Close()
}

Write-Host ""
Write-Host "$Command $Version installed. Run '$Command' in a project directory to start."
Write-Host "Installs alongside any existing upstream 'opencode' - this script never touches ~\.opencode or the upstream binary."
