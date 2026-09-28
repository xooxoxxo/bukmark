#!/bin/sh
# Installs the bukmark command, then sets up a bukmark server with Docker.
#
#   curl -fsSL https://bukmark.it/install.sh | sh
#   curl -fsSL https://bukmark.it/install.sh | sh -s -- --port 3001
#
# It puts one shell script, bukmark, in ~/.local/bin (BUKMARK_BIN_DIR picks
# another folder) and runs `bukmark setup`, passing on the options after
# `sh -s --`. It never uses sudo. Read the command first:
# https://bukmark.it/bukmark
#
# Everything runs from main(), called on the last line, so a download that
# stops part way runs nothing.
set -eu

say() { printf '%s\n' "$*"; }
warn() { printf 'bukmark: %s\n' "$*" >&2; }
die() {
  warn "$*"
  exit 1
}
have() { command -v "$1" >/dev/null 2>&1; }

# Kept word for word the same in packaging/bin/bukmark (a test checks).
require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    case $(uname -s) in
      Darwin) die "Docker is not installed. Install Docker Desktop, OrbStack or Colima, start it, and try again." ;;
      *) die "Docker is not installed. Install Docker Engine (https://docs.docker.com/engine/install/) and try again." ;;
    esac
  fi
  if ! docker_error=$(docker info 2>&1 >/dev/null); then
    case $docker_error in
      *"permission denied"*)
        die "Docker is running, but your user may not use it. Add yourself to the docker group (https://docs.docker.com/engine/install/linux-postinstall/), log in again, and try again." ;;
    esac
    case $(uname -s) in
      Darwin) die "Docker is not running. Start Docker Desktop, OrbStack or Colima (colima start), and try again." ;;
      *) die "Docker is not running. Start it (for example: sudo systemctl start docker) and try again." ;;
    esac
  fi
  if ! docker compose version >/dev/null 2>&1; then
    die "Docker Compose v2 is missing: \`docker compose\` does not work. Install the Compose plugin (https://docs.docker.com/compose/install/) and try again."
  fi
}

download() {
  if have curl; then
    curl -fsSL -o "$2" "$1"
  elif have wget; then
    wget -q -O "$2" "$1"
  else
    die "Neither curl nor wget is installed. Install one and try again."
  fi
}

on_path() {
  case ":$PATH:" in
    *":$1:"*) return 0 ;;
    *) return 1 ;;
  esac
}

# How to put DIR on PATH, for the shell this person uses.
path_hint() {
  case $1 in
    "$HOME"/*) shown="\$HOME${1#"$HOME"}" ;;
    *) shown=$1 ;;
  esac
  case ${SHELL:-} in
    */zsh) line="echo 'export PATH=\"$shown:\$PATH\"' >> ~/.zshrc" ;;
    */bash)
      if [ "$(uname -s)" = Darwin ]; then
        line="echo 'export PATH=\"$shown:\$PATH\"' >> ~/.bash_profile"
      else
        line="echo 'export PATH=\"$shown:\$PATH\"' >> ~/.bashrc"
      fi
      ;;
    */fish) line="fish_add_path $shown" ;;
    *) line="echo 'export PATH=\"$shown:\$PATH\"' >> ~/.profile" ;;
  esac
  cat <<EOF

$1 is not on your PATH, so your shell does not find bukmark yet.
Add it, then open a new terminal:
  $line
Until then, run it as $1/bukmark
EOF
}

main() {
  base=${BUKMARK_DOWNLOAD_BASE:-https://bukmark.it}
  bin_dir=${BUKMARK_BIN_DIR:-$HOME/.local/bin}
  target=$bin_dir/bukmark

  require_docker

  tmp=$(mktemp "${TMPDIR:-/tmp}/bukmark.XXXXXX")
  trap 'rm -f "$tmp"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  say "Downloading the bukmark command from $base/bukmark"
  download "$base/bukmark" "$tmp" || die "Could not download $base/bukmark. Check your internet connection and try again."

  # A proxy or an error page can answer 200 with HTML. Only a shell script
  # that runs and names its version gets installed.
  [ "$(head -n 1 "$tmp")" = "#!/bin/sh" ] || die "$base/bukmark is not the bukmark script. Nothing was installed."
  sh -n "$tmp" 2>/dev/null || die "$base/bukmark is not a working shell script. Nothing was installed."
  version=$(sh "$tmp" version 2>/dev/null) || version=
  case $version in
    "bukmark "[0-9]*) ;;
    *) die "$base/bukmark did not report its version. Nothing was installed." ;;
  esac

  mkdir -p "$bin_dir" 2>/dev/null && [ -w "$bin_dir" ] ||
    die "Cannot write to $bin_dir. Set BUKMARK_BIN_DIR to a folder you own and try again."
  # Replace in one step, so a bukmark that is running keeps its file.
  cp "$tmp" "$bin_dir/.bukmark.$$"
  chmod 755 "$bin_dir/.bukmark.$$"
  mv -f "$bin_dir/.bukmark.$$" "$target"
  say "Installed $version to $target"

  if on_path "$bin_dir"; then
    first=$(command -v bukmark 2>/dev/null || true)
    if [ -n "$first" ] && [ "$first" != "$target" ]; then
      warn "Another bukmark comes first on your PATH: $first. Typing bukmark runs that one."
    fi
  fi

  say ""
  status=0
  "$target" setup "$@" || status=$?

  on_path "$bin_dir" || path_hint "$bin_dir"
  exit "$status"
}

main "$@"
