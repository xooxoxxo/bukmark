#!/usr/bin/env bats
# packaging/install.sh, fed on stdin the way `curl ... | sh` runs it, with
# downloads from file:// URLs and the fake docker and curl (see stubs/).
# Run from the repo root: bats packaging/test

bats_require_minimum_version 1.5.0
load helper

setup() {
  common_setup
  # What the site serves: install.sh and bukmark side by side.
  SITE=$BATS_TEST_TMPDIR/site
  mkdir -p "$SITE"
  cp "$CLI" "$SITE/bukmark"
  export BUKMARK_DOWNLOAD_BASE=file://$SITE
  export BUKMARK_BIN_DIR=$BATS_TEST_TMPDIR/bin
}

# `curl -fsSL https://bukmark.it/install.sh | sh -s -- ARGS`
install_sh() {
  run --separate-stderr "$TEST_SH" -s -- "$@" <"$INSTALLER"
}

@test "installs the command it downloads and runs its setup, passing options on" {
  install_sh --port 3999
  [ "$status" -eq 0 ]
  [ -x "$BUKMARK_BIN_DIR/bukmark" ]
  cmp "$BUKMARK_BIN_DIR/bukmark" "$CLI"
  [ "$(file_mode "$BUKMARK_BIN_DIR/bukmark")" = 755 ]
  [[ $output == *"Installed bukmark $(sed -n 's/^BUKMARK_CLI_VERSION=//p' "$CLI") to $BUKMARK_BIN_DIR/bukmark"* ]]
  grep -qx 'PORT=3999' "$BUKMARK_HOME/.env"
  [[ $output == *"bukmark is running at http://localhost:3999"* ]]
  grep -q "^curl -fsSL -o .* $BUKMARK_DOWNLOAD_BASE/bukmark$" "$FAKE_LOG"
  [ -z "$(find "$BUKMARK_BIN_DIR" -name '.bukmark.*')" ]
}

@test "installs to ~/.local/bin unless BUKMARK_BIN_DIR says otherwise" {
  unset BUKMARK_BIN_DIR
  install_sh
  [ "$status" -eq 0 ]
  cmp "$HOME/.local/bin/bukmark" "$CLI"
}

@test "says how to put the folder on PATH when it is not there" {
  SHELL=/bin/zsh install_sh
  [ "$status" -eq 0 ]
  [[ $output == *"$BUKMARK_BIN_DIR is not on your PATH"* ]]
  [[ $output == *">> ~/.zshrc"* ]]
  [[ $output == *"run it as $BUKMARK_BIN_DIR/bukmark"* ]]
}

@test "writes the PATH line with \$HOME and for the person's shell" {
  export BUKMARK_BIN_DIR=$HOME/.local/bin
  SHELL=/usr/bin/fish install_sh
  [[ $output == *'fish_add_path $HOME/.local/bin'* ]]
  SHELL=/bin/dash install_sh
  [[ $output == *"echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.profile"* ]]
}

@test "says nothing about PATH when the folder is on it" {
  PATH="$BUKMARK_BIN_DIR:$PATH" install_sh
  [ "$status" -eq 0 ]
  [[ $output != *"not on your PATH"* ]]
  [[ $stderr != *"Another bukmark"* ]]
}

@test "warns when another bukmark comes first on PATH" {
  other=$BATS_TEST_TMPDIR/other
  mkdir -p "$other"
  printf '#!/bin/sh\n' >"$other/bukmark"
  chmod 755 "$other/bukmark"
  PATH="$other:$BUKMARK_BIN_DIR:$PATH" install_sh
  [ "$status" -eq 0 ]
  [[ $stderr == *"Another bukmark comes first on your PATH: $other/bukmark"* ]]
}

@test "replaces an older bukmark in place" {
  mkdir -p "$BUKMARK_BIN_DIR"
  printf '#!/bin/sh\necho old\n' >"$BUKMARK_BIN_DIR/bukmark"
  install_sh
  [ "$status" -eq 0 ]
  cmp "$BUKMARK_BIN_DIR/bukmark" "$CLI"
}

@test "without docker it stops before downloading anything" {
  export FAKE_UNAME=Darwin
  run --separate-stderr env PATH="$(minimal_path curl)" sh -s <"$INSTALLER"
  [ "$status" -eq 1 ]
  [[ $stderr == *"Docker is not installed. Install Docker Desktop, OrbStack or Colima"* ]]
  [ ! -s "$FAKE_LOG" ]
  [ ! -e "$BUKMARK_BIN_DIR" ]
}

@test "with docker stopped it stops before downloading anything" {
  export FAKE_NO_DAEMON=1
  install_sh
  [ "$status" -eq 1 ]
  [[ $stderr == *"Docker is not running"* ]]
  ! grep -q '^curl' "$FAKE_LOG"
  [ ! -e "$BUKMARK_BIN_DIR" ]
}

@test "a failed download installs nothing" {
  export BUKMARK_DOWNLOAD_BASE=file://$BATS_TEST_TMPDIR/nowhere
  install_sh
  [ "$status" -eq 1 ]
  [[ $stderr == *"Could not download $BUKMARK_DOWNLOAD_BASE/bukmark"* ]]
  [ ! -e "$BUKMARK_BIN_DIR" ]
}

@test "an HTML page instead of the script installs nothing" {
  printf '<!doctype html>\n<title>Not found</title>\n' >"$SITE/bukmark"
  install_sh
  [ "$status" -eq 1 ]
  [[ $stderr == *"is not the bukmark script. Nothing was installed."* ]]
  [ ! -e "$BUKMARK_BIN_DIR" ]
}

@test "a shell script that does not report a version installs nothing" {
  printf '#!/bin/sh\necho hello\n' >"$SITE/bukmark"
  install_sh
  [ "$status" -eq 1 ]
  [[ $stderr == *"did not report its version"* ]]
  [ ! -e "$BUKMARK_BIN_DIR" ]
}

@test "a script cut short in the download installs nothing" {
  head -c 2000 "$CLI" >"$SITE/bukmark"
  install_sh
  [ "$status" -eq 1 ]
  [ ! -e "$BUKMARK_BIN_DIR" ]
}

@test "an installer cut short anywhere before its last line runs nothing" {
  size=$(wc -c <"$INSTALLER")
  last=$(tail -n 1 "$INSTALLER" | wc -c)
  [ "$(tail -n 1 "$INSTALLER")" = 'main "$@"' ]
  cut=1
  while [ "$cut" -lt $((size - last)) ]; do
    head -c "$cut" "$INSTALLER" >"$BATS_TEST_TMPDIR/partial.sh"
    "$TEST_SH" -s <"$BATS_TEST_TMPDIR/partial.sh" >/dev/null 2>&1 || true
    if [ -s "$FAKE_LOG" ] || [ -e "$BUKMARK_BIN_DIR" ]; then
      echo "cut at byte $cut ran something"
      return 1
    fi
    cut=$((cut + 37))
  done
}

@test "setup's failure is the installer's failure, and the PATH hint still shows" {
  export FAKE_BUSY_PORTS=3000
  install_sh
  [ "$status" -eq 1 ]
  [ -x "$BUKMARK_BIN_DIR/bukmark" ]
  [[ $stderr == *"Port 3000 is already in use"* ]]
  [[ $output == *"is not on your PATH"* ]]
}

@test "without curl it downloads with wget" {
  run --separate-stderr env PATH="$(minimal_path docker wget)" sh -s -- --port 3998 <"$INSTALLER"
  [ "$status" -eq 0 ]
  cmp "$BUKMARK_BIN_DIR/bukmark" "$CLI"
  grep -q "^wget -q -O .* $BUKMARK_DOWNLOAD_BASE/bukmark$" "$FAKE_LOG"
}

@test "the installer and the command check Docker with the same code" {
  extract() { sed -n '/^require_docker() {$/,/^}$/p' "$1"; }
  [ -n "$(extract "$CLI")" ]
  [ "$(extract "$CLI")" = "$(extract "$INSTALLER")" ]
}

@test "the installer never uses sudo" {
  ! grep -v '^ *#' "$INSTALLER" | grep -v 'for example: sudo systemctl' | grep -qw sudo
  ! grep -v '^ *#' "$CLI" | grep -v 'for example: sudo systemctl' | grep -qw sudo
}
