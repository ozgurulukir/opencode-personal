#!/usr/bin/env bash
# Hermetic (no-network) non-interference tests for install.sh.
#
# Scenario A (--binary): fake upstream + rc entry in a temp HOME; install a
#   local dummy binary; assert upstream untouched + append-only rc + fork name.
# Scenario B (archive): a curl shim serves a pre-made local .tar.gz, exercising
#   the full download path: extract -> rename -> copy-all (incl. native lib).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }

sha256() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
    else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# fresh_home <name>: temp HOME with a simulated upstream install + rc entry
fresh_home() {
    local h="$WORK/$1"
    mkdir -p "$h/.opencode/bin" "$h/.local/bin"
    printf '#!/bin/sh\necho upstream-1.0.0\n' > "$h/.opencode/bin/opencode"
    chmod 755 "$h/.opencode/bin/opencode"
    printf 'export PATH="$HOME/.opencode/bin:$PATH"\n' > "$h/.bashrc"
    echo "$h"
}

assert_upstream_untouched() {
    local h="$1" before="$2"
    [ "$(sha256 "$h/.opencode/bin/opencode")" = "$before" ] \
        || fail "upstream ~/.opencode/bin/opencode was modified"
    [ ! -e "$h/.local/bin/opencode" ] || fail "~/.local/bin/opencode was created"
    [ ! -e "$h/.opencode/bin/opencode-personal" ] || fail "fork binary leaked into upstream dir"
}

assert_rc_append_only() {
    local h="$1"
    [ "$(sed -n '1p' "$h/.bashrc")" = 'export PATH="$HOME/.opencode/bin:$PATH"' ] \
        || fail "existing rc line was modified"
    [ "$(wc -l < "$h/.bashrc")" -eq 4 ] || fail "rc file gained unexpected lines (expected 4)"
    grep -Fxq '# opencode-personal' "$h/.bashrc" || fail "fork rc marker missing"
    grep -Fxq "export PATH=$h/.opencode-personal/bin:\$PATH" "$h/.bashrc" \
        || fail "fork PATH line missing"
    ! grep -Fxq '# opencode' "$h/.bashrc" || fail "upstream rc marker was written"
}

# --- Scenario A: --binary install ---------------------------------------------
HOME_A="$(fresh_home home-a)"
UPSTREAM_A="$(sha256 "$HOME_A/.opencode/bin/opencode")"
printf '#!/bin/sh\necho personal-1.14.48-p.1\n' > "$WORK/opencode-fake"
chmod 755 "$WORK/opencode-fake"

HOME="$HOME_A" SHELL=/bin/bash bash "$ROOT/install.sh" --binary "$WORK/opencode-fake"

assert_upstream_untouched "$HOME_A" "$UPSTREAM_A"
assert_rc_append_only "$HOME_A"
[ -x "$HOME_A/.opencode-personal/bin/opencode-personal" ] \
    || fail "A: opencode-personal not installed in ~/.opencode-personal/bin"
[ ! -e "$HOME_A/.opencode-personal/bin/opencode" ] \
    || fail "A: an 'opencode'-named file leaked into the fork dir"
[ "$("$HOME_A/.opencode-personal/bin/opencode-personal" --version)" = "personal-1.14.48-p.1" ] \
    || fail "A: fork binary does not run"
echo "PASS: scenario A (--binary) coexists with an existing upstream install"

# --- Scenario B: archive install via curl shim (extract -> rename -> copy-all) --
HOME_B="$(fresh_home home-b)"
UPSTREAM_B="$(sha256 "$HOME_B/.opencode/bin/opencode")"

# Pre-made local "release" archive: binary + native lib at top level (like build.ts)
ARCH="$WORK/archive"
mkdir -p "$ARCH"
printf '#!/bin/sh\necho 1.14.48-p.1\n' > "$ARCH/opencode"
printf 'native-lib-stub\n' > "$ARCH/libopentui.so"
tar -czf "$WORK/opencode-linux-x64.tar.gz" -C "$ARCH" .

# curl shim: serves the local archive / canned API responses instead of the network
SHIM_VERSION="1.14.48-p.1"
SHIM_ARCHIVE="$WORK/opencode-linux-x64.tar.gz"
export SHIM_VERSION SHIM_ARCHIVE
mkdir -p "$WORK/shim"
cat > "$WORK/shim/curl" <<'SH'
#!/bin/sh
url=""; out=""; prev=""
for arg in "$@"; do
    [ "$prev" = "-o" ] && out="$arg"
    case "$arg" in http://*|https://*) url="$arg" ;; esac
    prev="$arg"
done
case "$url" in
    *"/releases/download/"*|*"/releases/latest/download/"*)
        cat "$SHIM_ARCHIVE" > "${out:-/dev/null}" ;;
    *"api.github.com/repos/"*"releases/latest"*)
        printf '{"tag_name": "v%s"}' "$SHIM_VERSION" ;;
    *"/releases/tag/"*)
        printf '200' ;;
    *) exit 1 ;;
esac
SH
chmod 755 "$WORK/shim/curl"

HOME="$HOME_B" SHELL=/bin/bash PATH="$WORK/shim:$PATH" \
    bash "$ROOT/install.sh" --version "$SHIM_VERSION"

assert_upstream_untouched "$HOME_B" "$UPSTREAM_B"
assert_rc_append_only "$HOME_B"
[ -x "$HOME_B/.opencode-personal/bin/opencode-personal" ] \
    || fail "B: opencode-personal not installed in ~/.opencode-personal/bin"
[ -f "$HOME_B/.opencode-personal/bin/libopentui.so" ] \
    || fail "B: native lib was not copied next to the binary (copy-all regression)"
[ ! -e "$HOME_B/.opencode-personal/bin/opencode" ] \
    || fail "B: unrenamed 'opencode' binary leaked into the fork dir"
[ "$("$HOME_B/.opencode-personal/bin/opencode-personal" --version)" = "1.14.48-p.1" ] \
    || fail "B: renamed binary does not run"
echo "PASS: scenario B (archive) extracts, renames, and copies all contents"

echo "PASS: install.sh coexists with an existing upstream opencode install"
