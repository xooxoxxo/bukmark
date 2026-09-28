#!/bin/sh
# Point the Homebrew formula at a bukmark release.
#
#   packaging/homebrew/update-formula.sh [-f formula.rb] [-u url] <version> [tarball]
#
# Downloads the source tarball GitHub serves for tag v<version>, checks that
# its packaging/bin/bukmark reports the same version, and rewrites url and
# sha256 in the formula (bukmark.rb next to this script unless -f says
# otherwise). Copy the result to Formula/bukmark.rb in xooxoxxo/homebrew-tap.
#
# With a local tarball, it hashes that file instead and points the formula at
# it (file://), to try a release with brew before it is tagged. -u sets the url
# to write in either case.
set -eu

REPO="xooxoxxo/bukmark"

usage() {
  cat <<'USAGE'
Usage: update-formula.sh [-f formula.rb] [-u url] <version> [tarball]

  version   release version, e.g. 0.3.0 or v0.3.0 (tag v<version>)
  tarball   hash this local .tar.gz instead of downloading the tag

  -f FILE   formula to rewrite (default: bukmark.rb next to this script)
  -u URL    url to write (default: the GitHub tag tarball, or file://tarball)
USAGE
}

die() {
  printf 'update-formula: %s\n' "$*" >&2
  exit 1
}

here=$(cd "$(dirname "$0")" && pwd)
formula="$here/bukmark.rb"
url=""

while getopts f:u:h opt; do
  case $opt in
    f) formula=$OPTARG ;;
    u) url=$OPTARG ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
if [ $# -lt 1 ] || [ $# -gt 2 ]; then
  usage >&2
  exit 2
fi

version=${1#v}
case $version in
  *[!0-9A-Za-z.-]*) die "not a version: $1" ;;
  [0-9]*.[0-9]*) ;;
  *) die "not a version: $1" ;;
esac

[ -f "$formula" ] || die "no formula at $formula"

tmp=$(mktemp -d "${TMPDIR:-/tmp}/bukmark-formula.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ $# -eq 2 ]; then
  [ -f "$2" ] || die "no such file: $2"
  tarball="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
  [ -n "$url" ] || url="file://$tarball"
else
  [ -n "$url" ] || url="https://github.com/$REPO/archive/refs/tags/v$version.tar.gz"
  tarball="$tmp/source.tar.gz"
  printf 'Downloading %s\n' "$url"
  curl -fsSL -o "$tarball" "$url" ||
    die "could not download $url. Is tag v$version pushed, and is the repository public?"
fi

# The url lands in a Ruby string; keep it to characters that need no escaping.
case $url in
  *[\"\\\ ]* | *'#{'*) die "url has a space, quote, backslash or #{: $url" ;;
esac

# brew test runs "bukmark version" and expects the formula's version in it.
cli=$(tar -tzf "$tarball" | grep '^[^/]*/packaging/bin/bukmark$' | head -n 1)
[ -n "$cli" ] || die "$tarball has no packaging/bin/bukmark"
cli_version=$(tar -xzOf "$tarball" "$cli" |
  sed -n 's/^BUKMARK_CLI_VERSION=["'\'']\{0,1\}\([^"'\'' ]*\).*/\1/p' | head -n 1)
[ "$cli_version" = "$version" ] ||
  die "packaging/bin/bukmark in the tarball has BUKMARK_CLI_VERSION=${cli_version:-(none)}, not $version. Set it to $version before tagging."
mode=$(tar -tvzf "$tarball" "$cli" | cut -c1-4)
case $mode in
  -rwx | -r-x) ;;
  *) die "packaging/bin/bukmark is not executable in the tarball (mode $mode). Run: git update-index --chmod=+x packaging/bin/bukmark" ;;
esac

if command -v sha256sum >/dev/null 2>&1; then
  sha=$(sha256sum "$tarball" | cut -d ' ' -f 1)
elif command -v shasum >/dev/null 2>&1; then
  sha=$(shasum -a 256 "$tarball" | cut -d ' ' -f 1)
else
  die "needs sha256sum or shasum"
fi

# Homebrew reads the version from a url ending in v<version>.tar.gz or
# bukmark-<version>.tar.gz. Any other url needs an explicit version line.
case $url in
  */v"$version".tar.gz | */bukmark-"$version".tar.gz) version_line="" ;;
  *) version_line=$version ;;
esac

# Rewrite url and sha256, set or drop the version line, and drop any revision:
# a new version starts again at revision 0.
awk -v url="$url" -v sha="$sha" -v ver="$version_line" '
  /^  url "/ { print "  url \"" url "\""; urls++; next }
  /^  version "/ { next }
  /^  revision / { next }
  /^  sha256 "/ {
    if (ver != "") print "  version \"" ver "\""
    print "  sha256 \"" sha "\""
    shas++
    next
  }
  { print }
  END { if (urls != 1 || shas != 1) exit 1 }
' "$formula" >"$tmp/formula.rb" ||
  die "$formula: expected exactly one url line and one sha256 line"
cp "$tmp/formula.rb" "$formula"

printf 'Updated %s\n  version  %s\n  url      %s\n  sha256   %s\n' \
  "$formula" "$version" "$url" "$sha"
