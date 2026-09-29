#requires -Version 5.1
# Hermetic non-interference test for install.ps1.
#
# Filesystem: fully hermetic. The installer runs in a CHILD pwsh process with
# USERPROFILE/HOME/HOMEDRIVE/HOMEPATH overridden to a temp profile, so the fake
# upstream (~\.opencode) and the fork install (~\.opencode-personal) both land
# in the temp profile. The real %USERPROFILE% is never touched, so this test is
# safe on machines that already have an upstream install.
#
# User PATH: HKCU\Environment\Path is the one surface env-var overrides CANNOT
# redirect. This one real mutation is temporarily accepted: snapshot the RAW
# registry value (+ its kind) before the child runs, snapshot again immediately
# after the child returns (inside try, BEFORE finally restores), restore in
# finally - kind-preserving, so the restore itself can never degrade
# REG_EXPAND_SZ to REG_SZ. All cleanup lives in finally so a failure can never
# leave artifacts.
#
# Why a child process: $HOME is a PowerShell automatic variable fixed at
# session start; only a fresh pwsh recomputes it from the overridden env.
# All four vars are overridden because their resolution order is
# version-dependent (pwsh 7 consults HOME; Windows PowerShell 5.1 consults
# HOMEDRIVE+HOMEPATH, else USERPROFILE).
$ErrorActionPreference = "Stop"

function Fail([string]$msg) {
    Write-Host "FAIL: $msg" -ForegroundColor Red
    # A top-level `exit` bypasses the PASS-path cleanup try/finally below, so a
    # failed assertion would otherwise leak the temp profile/work dirs.
    # Guarded: both are still unset if we fail before they are computed.
    if ($tempProfile) { Remove-Item $tempProfile -Recurse -Force -ErrorAction SilentlyContinue }
    if ($work) { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
    exit 1
}

if (-not (Get-Command pwsh -ErrorAction SilentlyContinue)) {
    Fail "pwsh (PowerShell 7+) is required to run this test"
}

$repoRoot     = Resolve-Path (Join-Path $PSScriptRoot "..")
$installer    = Resolve-Path (Join-Path $repoRoot "install.ps1")
$tempProfile  = Join-Path ([IO.Path]::GetTempPath()) "ocp-isolation-profile-$PID"
$work         = Join-Path ([IO.Path]::GetTempPath()) "ocp-isolation-work-$PID"
$forkDir      = Join-Path $tempProfile ".opencode-personal\bin"

# 1. Simulated upstream + fake release binary, both inside the TEMP profile
New-Item -ItemType Directory -Force -Path (Join-Path $tempProfile ".opencode\bin") | Out-Null
$upstream = Join-Path $tempProfile ".opencode\bin\opencode.exe"
Set-Content -LiteralPath $upstream -Value "fake upstream binary" -Encoding Ascii
$upstreamShaBefore = (Get-FileHash -LiteralPath $upstream -Algorithm SHA256).Hash
New-Item -ItemType Directory -Force -Path $work | Out-Null
$fake = Join-Path $work "opencode-personal.exe"
Copy-Item -LiteralPath $upstream -Destination $fake -Force

# 2. Snapshot the real user PATH (the one surface env overrides cannot isolate).
# RAW registry read: [Environment]::GetEnvironmentVariable would expand
# REG_EXPAND_SZ %vars% with THIS process's environment - the exact corruption
# this test exists to catch.
$envKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
$userPathBefore = $envKey.GetValue("Path", $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
$userPathKindBefore = if ($null -ne $userPathBefore) { $envKey.GetValueKind("Path") } else { $null }

# 3. Env override (all four vars pwsh may consult for $HOME)
$realUserProfile = $env:USERPROFILE; $realHome     = $env:HOME
$realHomeDrive   = $env:HOMEDRIVE;   $realHomePath = $env:HOMEPATH
$homeDrive = [IO.Path]::GetPathRoot($tempProfile).TrimEnd("\")
$homePath  = $tempProfile.Substring($homeDrive.Length)

$userPathAfter = $null
try {
    $env:USERPROFILE = $tempProfile
    $env:HOME        = $tempProfile
    $env:HOMEDRIVE   = $homeDrive
    $env:HOMEPATH    = $homePath

    # Run the installer in a child pwsh so $HOME is recomputed from the override
    & pwsh -NoProfile -File $installer -Binary $fake

    # CRITICAL: snapshot the post-install user PATH NOW, inside try, BEFORE
    # finally restores it. Reading it after finally would compare the restored
    # value, so the +1-entry assertion could never pass. RAW read: env-var
    # overrides in this process cannot skew a registry value.
    $userPathAfter = $envKey.GetValue("Path", $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $userPathKindAfter = if ($null -ne $userPathAfter) { $envKey.GetValueKind("Path") } else { $null }
} finally {
    # Restore EVERYTHING the test touched - runs even when assertions fail.
    # Kind-preserving raw write: restoring via SetEnvironmentVariable would
    # itself degrade REG_EXPAND_SZ to REG_SZ (the bug class under test).
    if ($null -ne $userPathBefore) {
        $envKey.SetValue("Path", $userPathBefore, $userPathKindBefore)
    } elseif ($null -ne $envKey.GetValue("Path")) {
        $envKey.DeleteValue("Path")   # Path was unset before; the installer created it
    }
    $envKey.Close()
    $env:USERPROFILE = $realUserProfile; $env:HOME     = $realHome
    $env:HOMEDRIVE   = $realHomeDrive;   $env:HOMEPATH = $realHomePath
}

# 4. Assertions (against snapshots; no live environment reads)
if ($null -eq $userPathAfter) { Fail "installer did not run" }
if ((Get-FileHash -LiteralPath $upstream -Algorithm SHA256).Hash -ne $upstreamShaBefore) {
    Fail "upstream binary was modified"
}
if (-not (Test-Path -LiteralPath (Join-Path $forkDir "opencode-personal.exe"))) {
    Fail "opencode-personal.exe not installed in $forkDir"
}
if (Test-Path -LiteralPath (Join-Path $forkDir "opencode.exe")) {
    Fail "an 'opencode.exe' leaked into the fork dir"
}

$before = @($userPathBefore -split ";" | Where-Object { $_ })
$after  = @($userPathAfter  -split ";" | Where-Object { $_ })
if ($after.Count -ne $before.Count + 1) {
    Fail "user PATH entry count changed unexpectedly ($($before.Count) -> $($after.Count))"
}
if ($after -notcontains $forkDir) { Fail "fork dir not appended to user PATH" }
# Preservation check across representation differences: match case-insensitively
# (PowerShell -contains is case-insensitive) on the RAW form AND on an env-expanded
# form normalized identically on both sides, so a legitimate %VAR% <-> literal
# rewrite is not misread as a removal - while a genuinely dropped entry still
# fails. Runs AFTER finally, so %USERPROFILE% etc. expand with the real
# environment consistently on both sides.
$afterNorm = @($after | ForEach-Object { [Environment]::ExpandEnvironmentVariables($_) })
foreach ($e in $before) {
    $expanded = [Environment]::ExpandEnvironmentVariables($e)
    if ($after -notcontains $e -and $afterNorm -notcontains $expanded) {
        Fail "existing PATH entry removed: $e"
    }
}
# Kind check: appending must not degrade the registry value kind
# (REG_EXPAND_SZ -> REG_SZ would freeze %VAR% entries to literal paths).
if ($null -ne $userPathKindBefore -and $userPathKindAfter -ne $userPathKindBefore) {
    Fail "user PATH registry kind changed ($userPathKindBefore -> $userPathKindAfter): installer rewrote the value instead of appending"
}

# 5. Cleanup of temp artifacts on the PASS path (Fail() removes them on FAIL)
try {
    Write-Host "PASS: install.ps1 coexists with an existing upstream opencode install"
} finally {
    Remove-Item $tempProfile -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
