# Shared set-up for the bats tests: a throwaway HOME, the fake docker and
# curl from stubs/ first on PATH, and a log of every call they get.
#
# BUKMARK_TEST_SH picks the shell that runs the scripts (default sh), so
#   BUKMARK_TEST_SH=dash bats packaging/test
# checks them under a strict POSIX shell too.

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
CLI="$REPO_ROOT/packaging/bin/bukmark"
INSTALLER="$REPO_ROOT/packaging/install.sh"
STUBS="$BATS_TEST_DIRNAME/stubs"
TEST_SH="${BUKMARK_TEST_SH:-sh}"

common_setup() {
  REAL_CURL="$(command -v curl)"
  REAL_UNAME="$(command -v uname)"
  REAL_DOCKER="$(command -v docker || true)"
  # The real docker finds its plugins (compose) and contexts under the real HOME.
  REAL_DOCKER_CONFIG="${DOCKER_CONFIG:-$HOME/.docker}"
  export REAL_CURL REAL_UNAME
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME"
  export BUKMARK_HOME="$HOME/.bukmark"
  export FAKE_LOG="$BATS_TEST_TMPDIR/calls.log"
  : >"$FAKE_LOG"
  export PATH="$STUBS:$PATH"
  export BUKMARK_WAIT_SECONDS=4
  unset BUKMARK_PORT BUKMARK_VERSION BUKMARK_IMAGE BUKMARK_BIN_DIR BUKMARK_DOWNLOAD_BASE \
    PORT POSTGRES_PASSWORD FAKE_UNAME
}

# Runs the bukmark command with the test shell; stdout in $output, stderr in $stderr.
bukmark() {
  run --separate-stderr "$TEST_SH" "$CLI" "$@"
}

# A PATH with only the POSIX tools the scripts use, uname, and the stubs
# named, so a test can take docker, curl or wget away.
minimal_path() {
  local dir="$BATS_TEST_TMPDIR/minbin" tool
  mkdir -p "$dir"
  for tool in cat sed tail head od tr mkdir chmod mv rm rmdir cmp cp sleep grep mktemp basename; do
    ln -sf "$(PATH="${PATH#"$STUBS:"}" command -v "$tool")" "$dir/$tool"
  done
  ln -sf "$(command -v "$TEST_SH")" "$dir/sh"
  for tool in uname "$@"; do ln -sf "$STUBS/$tool" "$dir/$tool"; done
  echo "$dir"
}

file_mode() {
  stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"
}

# The compose calls the fake docker saw, without the project flags.
compose_calls() {
  sed -n 's/^docker compose -p bukmark-cli --project-directory [^ ]* -f [^ ]*compose\.yml //p' "$FAKE_LOG"
}
