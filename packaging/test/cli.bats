#!/usr/bin/env bats
# packaging/bin/bukmark against a fake docker and curl (see stubs/).
# Run from the repo root: bats packaging/test

bats_require_minimum_version 1.5.0
load helper

setup() {
  common_setup
}

teardown() {
  if [ -n "${LISTENER_PID:-}" ]; then kill "$LISTENER_PID" 2>/dev/null || true; fi
}

# --- help, version, unknown commands ---------------------------------------

@test "help lists every command and exits 0" {
  bukmark help
  [ "$status" -eq 0 ]
  for cmd in setup start stop restart status logs update open uninstall version help; do
    [[ $output == *"  $cmd"* ]] || { echo "help misses $cmd"; return 1; }
  done
}

@test "no command prints help and exits 0" {
  bukmark
  [ "$status" -eq 0 ]
  [[ $output == *"Usage: bukmark <command>"* ]]
}

@test "an unknown command prints help to stderr and exits 2" {
  bukmark frobnicate
  [ "$status" -eq 2 ]
  [ -z "$output" ]
  [[ $stderr == *"Unknown command: frobnicate"* ]]
  [[ $stderr == *"Usage: bukmark <command>"* ]]
}

@test "a command that takes no options refuses one with exit 2" {
  bukmark stop --now
  [ "$status" -eq 2 ]
  [[ $stderr == *"takes no options: --now"* ]]
}

@test "version prints BUKMARK_CLI_VERSION and needs no docker" {
  export FAKE_NO_DAEMON=1
  bukmark version
  [ "$status" -eq 0 ]
  expected=$(sed -n 's/^BUKMARK_CLI_VERSION=//p' "$CLI")
  [ "$output" = "bukmark $expected" ]
  [ ! -s "$FAKE_LOG" ]
}

# --- preconditions ---------------------------------------------------------

@test "without docker it says to install Docker Desktop, OrbStack or Colima on macOS" {
  export FAKE_UNAME=Darwin
  run --separate-stderr env PATH="$(minimal_path curl)" sh "$CLI" setup
  [ "$status" -eq 1 ]
  [[ $stderr == *"Docker is not installed. Install Docker Desktop, OrbStack or Colima"* ]]
  [ ! -e "$BUKMARK_HOME" ]
}

@test "without docker it points at Docker Engine on Linux" {
  export FAKE_UNAME=Linux
  run --separate-stderr env PATH="$(minimal_path curl)" sh "$CLI" setup
  [ "$status" -eq 1 ]
  [[ $stderr == *"Install Docker Engine (https://docs.docker.com/engine/install/)"* ]]
}

@test "a stopped docker daemon is named as the problem" {
  export FAKE_NO_DAEMON=1 FAKE_UNAME=Darwin
  bukmark setup
  [ "$status" -eq 1 ]
  [[ $stderr == *"Docker is not running. Start Docker Desktop, OrbStack or Colima"* ]]
  [ ! -e "$BUKMARK_HOME" ]
}

@test "no permission on the docker socket points at the docker group" {
  export FAKE_NO_PERMISSION=1 FAKE_UNAME=Linux
  bukmark setup
  [ "$status" -eq 1 ]
  [[ $stderr == *"docker group"* ]]
}

@test "a missing compose v2 is named as the problem" {
  export FAKE_NO_COMPOSE=1
  bukmark setup
  [ "$status" -eq 1 ]
  [[ $stderr == *"Docker Compose v2 is missing"* ]]
}

@test "commands other than setup need setup first" {
  for cmd in start stop restart logs update open; do
    bukmark "$cmd"
    [ "$status" -eq 1 ] || { echo "$cmd exited $status"; return 1; }
    [[ $stderr == *"not set up yet. Run: bukmark setup"* ]]
  done
  bukmark status
  [ "$status" -eq 3 ]
}

# --- setup -----------------------------------------------------------------

@test "setup writes compose.yml and a private .env, pulls, starts and waits" {
  bukmark setup
  [ "$status" -eq 0 ]
  [ -f "$BUKMARK_HOME/compose.yml" ]
  [ "$(file_mode "$BUKMARK_HOME/.env")" = 600 ]
  [ "$(file_mode "$BUKMARK_HOME")" = 700 ]
  grep -qx 'PORT=3000' "$BUKMARK_HOME/.env"
  grep -qx 'BUKMARK_VERSION=latest' "$BUKMARK_HOME/.env"
  ! grep -q '^BUKMARK_IMAGE=' "$BUKMARK_HOME/.env"

  run compose_calls
  [ "${lines[0]}" = "ps -q --status running app" ]
  [ "${lines[1]}" = "pull" ]
  [ "${lines[2]}" = "up -d --remove-orphans" ]
  grep -q '^curl .*http://127.0.0.1:3000/healthz$' "$FAKE_LOG"
}

@test "setup prints the URL and the three next steps" {
  bukmark setup
  [ "$status" -eq 0 ]
  [[ $output == *"bukmark is running at http://localhost:3000"* ]]
  [[ $output == *"1. Open http://localhost:3000 and set your password"* ]]
  [[ $output == *"2. Install the browser extension: https://bukmark.it/docs/extension/"* ]]
  [[ $output == *"3. In the extension, log in to http://localhost:3000"* ]]
}

@test "setup run after the password is set says to log in, not to set it" {
  FAKE_SETUP_COMPLETE=1 bukmark setup
  [ "$status" -eq 0 ]
  [[ $output == *"1. Open http://localhost:3000 and log in."* ]]
  [[ $output != *"set your password"* ]]
}

@test "the database password is 32 random hex characters and never printed" {
  bukmark setup
  [ "$status" -eq 0 ]
  password=$(sed -n 's/^POSTGRES_PASSWORD=//p' "$BUKMARK_HOME/.env")
  [[ $password =~ ^[0-9a-f]{32}$ ]]
  [[ $output != *"$password"* ]]
  [[ $stderr != *"$password"* ]]
  ! grep -q "$password" "$FAKE_LOG"

  other=$BATS_TEST_TMPDIR/other
  BUKMARK_HOME=$other bukmark setup
  [ "$status" -eq 0 ]
  [ "$(sed -n 's/^POSTGRES_PASSWORD=//p' "$other/.env")" != "$password" ]
}

@test "compose.yml runs the published image and gives the database no host port" {
  bukmark setup
  compose=$BUKMARK_HOME/compose.yml
  grep -qxF '    image: ${BUKMARK_IMAGE:-ghcr.io/xooxoxxo/bukmark}:${BUKMARK_VERSION:-latest}' "$compose"
  grep -qxF '    image: pgvector/pgvector:pg17' "$compose"
  [ "$(grep -c 'ports:' "$compose")" -eq 1 ]
  # This machine only, unless setup --lan changes BUKMARK_LISTEN.
  grep -qxF '    ports: ["${BUKMARK_LISTEN:-127.0.0.1}:${PORT:-3000}:3000"]' "$compose"
  [ "$(grep -c 'restart: unless-stopped' "$compose")" -eq 2 ]
  grep -qF 'db: { condition: service_healthy }' "$compose"
  grep -qF 'DATABASE_URL: postgres://bukmark:${POSTGRES_PASSWORD:-}@db:5432/bukmark' "$compose"
  for name in TRUST_PROXY BUKMARK_CHECK_PAGES BUKMARK_EXTENSION_IDS; do
    grep -qF "      $name: \${$name:-" "$compose" || { echo "no $name"; return 1; }
  done
  ! grep -q build: "$compose"
}

@test "compose.yml is valid for the real docker compose" {
  real_compose() { DOCKER_CONFIG=$REAL_DOCKER_CONFIG "$REAL_DOCKER" compose "$@"; }
  { [ -n "$REAL_DOCKER" ] && real_compose version >/dev/null 2>&1; } || skip "no docker compose here"
  bukmark setup --port 3456
  run real_compose -p bukmark-cli --project-directory "$BUKMARK_HOME" -f "$BUKMARK_HOME/compose.yml" config
  [ "$status" -eq 0 ]
  [[ $output == *'published: "3456"'* ]]
  [[ $output == *"image: ghcr.io/xooxoxxo/bukmark:latest"* ]]
  password=$(sed -n 's/^POSTGRES_PASSWORD=//p' "$BUKMARK_HOME/.env")
  [[ $output == *"DATABASE_URL: postgres://bukmark:$password@db:5432/bukmark"* ]]
}

@test "setup --port N, --port=N and BUKMARK_PORT set the port" {
  bukmark setup --port 3490
  [ "$status" -eq 0 ]
  grep -qx 'PORT=3490' "$BUKMARK_HOME/.env"
  [[ $output == *"running at http://localhost:3490"* ]]
  grep -q '^curl .*http://127.0.0.1:3490/healthz$' "$FAKE_LOG"

  BUKMARK_HOME=$BATS_TEST_TMPDIR/b bukmark setup --port=3491
  grep -qx 'PORT=3491' "$BATS_TEST_TMPDIR/b/.env"

  BUKMARK_PORT=3492 BUKMARK_HOME=$BATS_TEST_TMPDIR/c bukmark setup
  grep -qx 'PORT=3492' "$BATS_TEST_TMPDIR/c/.env"
}

@test "setup serves this machine only unless --lan, and says how to open it up" {
  bukmark setup
  [ "$status" -eq 0 ]
  grep -qx 'BUKMARK_LISTEN=127.0.0.1' "$BUKMARK_HOME/.env"
  [[ $output == *"Only this machine can reach it. For your phone or other devices: bukmark setup --lan"* ]]

  BUKMARK_HOME=$BATS_TEST_TMPDIR/lan bukmark setup --lan
  [ "$status" -eq 0 ]
  grep -qx 'BUKMARK_LISTEN=0.0.0.0' "$BATS_TEST_TMPDIR/lan/.env"
  [[ $output == *"Set your password first"* ]]
}

@test "setup --lan and --local switch an existing install, changing only BUKMARK_LISTEN" {
  bukmark setup
  before=$(grep -v '^BUKMARK_LISTEN=' "$BUKMARK_HOME/.env")
  bukmark setup --lan
  [ "$status" -eq 0 ]
  grep -qx 'BUKMARK_LISTEN=0.0.0.0' "$BUKMARK_HOME/.env"
  [ "$(grep -v '^BUKMARK_LISTEN=' "$BUKMARK_HOME/.env")" = "$before" ]
  [ "$(stat -f %Lp "$BUKMARK_HOME/.env" 2>/dev/null || stat -c %a "$BUKMARK_HOME/.env")" = 600 ]
  bukmark setup --local
  grep -qx 'BUKMARK_LISTEN=127.0.0.1' "$BUKMARK_HOME/.env"
}

@test "setup refuses a port that is not a number with exit 2" {
  for bad in abc 0 70000 ''; do
    bukmark setup --port "$bad"
    [ "$status" -eq 2 ] || { echo "--port '$bad' exited $status"; return 1; }
  done
  bukmark setup --port
  [ "$status" -eq 2 ]
  [ ! -e "$BUKMARK_HOME/.env" ]
}

@test "setup keeps an existing .env byte for byte" {
  mkdir -p "$BUKMARK_HOME"
  printf 'POSTGRES_PASSWORD=mine\nPORT=3999\n' >"$BUKMARK_HOME/.env"
  cp "$BUKMARK_HOME/.env" "$BATS_TEST_TMPDIR/before"
  bukmark setup --port 3000
  [ "$status" -eq 0 ]
  cmp "$BUKMARK_HOME/.env" "$BATS_TEST_TMPDIR/before"
  [[ $stderr == *"Keeping port 3999"* ]]
  [[ $output == *"running at http://localhost:3999"* ]]
}

@test "setup run twice changes nothing the second time" {
  bukmark setup
  cp "$BUKMARK_HOME/.env" "$BATS_TEST_TMPDIR/env1"
  cp "$BUKMARK_HOME/compose.yml" "$BATS_TEST_TMPDIR/compose1"
  export FAKE_RUNNING=1 FAKE_BUSY_PORTS=3000
  bukmark setup
  [ "$status" -eq 0 ]
  cmp "$BUKMARK_HOME/.env" "$BATS_TEST_TMPDIR/env1"
  cmp "$BUKMARK_HOME/compose.yml" "$BATS_TEST_TMPDIR/compose1"
  [ -z "$(find "$BUKMARK_HOME" -name '.env.tmp.*' -o -name '.compose.yml.*')" ]
}

@test "setup refuses a port something else uses, and writes no .env" {
  export FAKE_BUSY_PORTS=3000
  bukmark setup
  [ "$status" -eq 1 ]
  [[ $stderr == *"Port 3000 is already in use"* ]]
  [[ $stderr == *"bukmark setup --port 3001"* ]]
  [ ! -e "$BUKMARK_HOME/.env" ]
  ! compose_calls | grep -q '^up'
  # ...so running it again with another port just works.
  bukmark setup --port 3001
  [ "$status" -eq 0 ]
  grep -qx 'PORT=3001' "$BUKMARK_HOME/.env"
}

@test "setup refuses a port a real program listens on" {
  PATH="${PATH#"$STUBS:"}" command -v python3 >/dev/null || skip "no python3"
  # Started from a subshell, so killing it at teardown prints no job notice.
  (
    python3 -c '
import socket, sys, time
s = socket.socket(); s.bind(("127.0.0.1", 0)); s.listen(8)
open(sys.argv[1], "w").write(str(s.getsockname()[1]))
time.sleep(30)' "$BATS_TEST_TMPDIR/port" 3>&- &
    echo $! >"$BATS_TEST_TMPDIR/listener.pid"
  )
  LISTENER_PID=$(cat "$BATS_TEST_TMPDIR/listener.pid")
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do [ -s "$BATS_TEST_TMPDIR/port" ] && break; sleep 0.2; done
  port=$(cat "$BATS_TEST_TMPDIR/port")
  # The real curl, not the stub: only docker is faked here.
  run --separate-stderr env PATH="$(minimal_path docker):$(dirname "$REAL_CURL")" sh "$CLI" setup --port "$port"
  [ "$status" -eq 1 ]
  [[ $stderr == *"Port $port is already in use"* ]]
}

@test "setup does not trip over its own running server on the port" {
  mkdir -p "$BUKMARK_HOME"
  printf 'POSTGRES_PASSWORD=mine\nPORT=3000\n' >"$BUKMARK_HOME/.env"
  export FAKE_RUNNING=1 FAKE_BUSY_PORTS=3000
  bukmark setup
  [ "$status" -eq 0 ]
}

@test "setup will not pair a new password with an earlier install's database" {
  export FAKE_OLD_VOLUME=1
  bukmark setup
  [ "$status" -eq 1 ]
  [[ $stderr == *"docker volume rm bukmark-cli_pgdata"* ]]
  [[ $stderr == *"Put that .env back to keep the data."* ]]
  [ ! -e "$BUKMARK_HOME/.env" ]
}

@test "setup fails when the server does not answer in time" {
  export FAKE_UNHEALTHY=1 BUKMARK_WAIT_SECONDS=2
  bukmark setup
  [ "$status" -eq 1 ]
  [[ $stderr == *"did not answer on http://localhost:3000 within 2 seconds"* ]]
  [[ $stderr == *"bukmark logs"* ]]
}

@test "setup keeps going on local images when the download fails" {
  export FAKE_PULL_FAILS=1
  bukmark setup
  [ "$status" -eq 0 ]
  [[ $stderr == *"Using the copies already on this machine"* ]]
  compose_calls | grep -qx 'up -d --remove-orphans'
}

@test "setup stops when the download fails and there is nothing to run" {
  export FAKE_PULL_FAILS=1 FAKE_NO_IMAGES=1
  bukmark setup
  [ "$status" -eq 1 ]
  [[ $stderr == *"Could not download the bukmark images"* ]]
  ! compose_calls | grep -q '^up'
}

@test "BUKMARK_IMAGE and BUKMARK_VERSION at setup are kept in .env" {
  BUKMARK_IMAGE=bukmark-local BUKMARK_VERSION=test bukmark setup
  [ "$status" -eq 0 ]
  grep -qx 'BUKMARK_IMAGE=bukmark-local' "$BUKMARK_HOME/.env"
  grep -qx 'BUKMARK_VERSION=test' "$BUKMARK_HOME/.env"
}

@test "PORT and POSTGRES_PASSWORD in the caller's environment never reach compose" {
  PORT=8080 POSTGRES_PASSWORD=hunter2 bukmark setup
  [ "$status" -eq 0 ]
  ! grep -q LEAK "$FAKE_LOG"
  grep -qx 'PORT=3000' "$BUKMARK_HOME/.env"
}

@test "a compose.override.yml next to compose.yml is loaded after it" {
  bukmark setup
  touch "$BUKMARK_HOME/compose.override.yml"
  : >"$FAKE_LOG"
  bukmark stop
  grep -q -- "-f $BUKMARK_HOME/compose.yml -f $BUKMARK_HOME/compose.override.yml stop$" "$FAKE_LOG"
}

@test "without curl it uses wget" {
  run --separate-stderr env PATH="$(minimal_path docker wget)" sh "$CLI" setup --port 3493
  [ "$status" -eq 0 ]
  grep -q '^wget .*http://127.0.0.1:3493/$' "$FAKE_LOG"
  grep -q '^wget .*http://127.0.0.1:3493/healthz$' "$FAKE_LOG"
  ! grep -q '^curl' "$FAKE_LOG"

  export FAKE_BUSY_PORTS=3494 BUKMARK_HOME=$BATS_TEST_TMPDIR/busy
  run --separate-stderr env PATH="$(minimal_path docker wget)" sh "$CLI" setup --port 3494
  [ "$status" -eq 1 ]
  [[ $stderr == *"Port 3494 is already in use"* ]]
}

# --- day-to-day commands ---------------------------------------------------

@test "start, stop, restart and logs drive compose" {
  bukmark setup
  : >"$FAKE_LOG"
  bukmark start
  [ "$status" -eq 0 ]
  bukmark stop
  [ "$status" -eq 0 ]
  [[ $output == *"Your data is kept"* ]]
  bukmark restart
  [ "$status" -eq 0 ]
  bukmark logs -f
  [ "$status" -eq 0 ]
  run compose_calls
  [ "$output" = "ps -q --status running app
up -d --remove-orphans
stop
stop
ps -q --status running app
up -d --remove-orphans
logs -f" ]
}

@test "status exits 0 when bukmark answers, 3 when it is stopped, 1 when it does not answer" {
  bukmark setup
  FAKE_RUNNING=1 bukmark status
  [ "$status" -eq 0 ]
  [[ $output == *"bukmark is running at http://localhost:3000"* ]]

  FAKE_UNHEALTHY=1 bukmark status
  [ "$status" -eq 3 ]
  [[ $output == *"bukmark is stopped"* ]]

  FAKE_UNHEALTHY=1 FAKE_RUNNING=1 bukmark status
  [ "$status" -eq 1 ]
}

@test "status says stopped when another program answers on bukmark's port" {
  bukmark setup
  # /healthz answers (the fake curl), but bukmark's app container is not running.
  bukmark status
  [ "$status" -eq 3 ]
  [[ $output == *"bukmark is stopped"* ]]
}

@test "restart stops with a clear message when the new PORT is taken" {
  bukmark setup
  sed 's/^PORT=3000$/PORT=3999/' "$BUKMARK_HOME/.env" >"$BUKMARK_HOME/.env.new"
  mv "$BUKMARK_HOME/.env.new" "$BUKMARK_HOME/.env"
  : >"$FAKE_LOG"
  FAKE_BUSY_PORTS=3999 bukmark restart
  [ "$status" -eq 1 ]
  [[ $stderr == *"Port 3999 is already in use"* ]]
  run compose_calls
  [[ $output != *"up -d"* ]]
}

@test "update pulls and restarts, and says whether anything changed" {
  bukmark setup
  : >"$FAKE_LOG"
  bukmark update
  [ "$status" -eq 0 ]
  [[ $output == *"bukmark is up to date (ghcr.io/xooxoxxo/bukmark:latest)"* ]]
  run compose_calls
  [ "${lines[0]}" = pull ]
  [ "${lines[1]}" = "up -d --remove-orphans" ]
  ! grep -q ' down' "$FAKE_LOG"

  FAKE_PULL_NEW=1 bukmark update
  [ "$status" -eq 0 ]
  [[ $output == *"bukmark is updated"* ]]
}

@test "update fails when the published image cannot be downloaded" {
  bukmark setup
  FAKE_PULL_FAILS=1 bukmark update
  [ "$status" -eq 1 ]
  [[ $output == *"on the version it already had"* ]]
  [[ $stderr == *"Not updated: could not download ghcr.io/xooxoxxo/bukmark:latest"* ]]
}

@test "update of a BUKMARK_IMAGE build only on this machine just restarts it" {
  BUKMARK_IMAGE=bukmark-local BUKMARK_VERSION=test bukmark setup
  FAKE_PULL_FAILS=1 bukmark update
  [ "$status" -eq 0 ]
  [[ $output == *"on the version it already had"* ]]
}

@test "open hands the URL to open on macOS and xdg-open elsewhere" {
  bukmark setup --port 3495
  FAKE_UNAME=Darwin bukmark open
  [ "$status" -eq 0 ]
  grep -qx 'open http://localhost:3495' "$FAKE_LOG"
  FAKE_UNAME=Linux bukmark open
  grep -qx 'xdg-open http://localhost:3495' "$FAKE_LOG"
}

# --- uninstall -------------------------------------------------------------

@test "uninstall removes the containers and keeps the data" {
  bukmark setup
  : >"$FAKE_LOG"
  bukmark uninstall
  [ "$status" -eq 0 ]
  compose_calls | grep -qx 'down --remove-orphans'
  ! grep -q -- --volumes "$FAKE_LOG"
  [ -f "$BUKMARK_HOME/.env" ]
  [[ $output == *"Your bookmarks are kept"* ]]
}

@test "uninstall --delete-data asks, and anything but 'delete' deletes nothing" {
  bukmark setup
  : >"$FAKE_LOG"
  run --separate-stderr "$TEST_SH" "$CLI" uninstall --delete-data <<<"yes"
  [ "$status" -eq 1 ]
  [[ $stderr == *"Type delete to confirm"* ]]
  [[ $stderr == *"Nothing was deleted"* ]]
  [ -f "$BUKMARK_HOME/.env" ]
  [ ! -s "$FAKE_LOG" ]

  run --separate-stderr "$TEST_SH" "$CLI" uninstall --delete-data </dev/null
  [ "$status" -eq 1 ]
  [ -f "$BUKMARK_HOME/.env" ]
}

@test "uninstall --delete-data removes containers, volumes and the folder once confirmed" {
  bukmark setup
  : >"$FAKE_LOG"
  run --separate-stderr "$TEST_SH" "$CLI" uninstall --delete-data <<<"delete"
  [ "$status" -eq 0 ]
  compose_calls | grep -qx 'down --volumes --remove-orphans'
  [ ! -e "$BUKMARK_HOME" ]
}

@test "uninstall --delete-data --yes does not ask, and leaves other people's files" {
  bukmark setup
  touch "$BUKMARK_HOME/notes.txt"
  run --separate-stderr "$TEST_SH" "$CLI" uninstall --delete-data --yes </dev/null
  [ "$status" -eq 0 ]
  [[ $stderr != *"Type delete"* ]]
  [ -f "$BUKMARK_HOME/notes.txt" ]
  [ ! -e "$BUKMARK_HOME/.env" ]
  [ ! -e "$BUKMARK_HOME/compose.yml" ]
  [[ $output == *"has other files in it, so it is kept"* ]]
}

@test "uninstall with nothing set up is a no-op" {
  bukmark uninstall --delete-data --yes
  [ "$status" -eq 0 ]
  [[ $output == *"Nothing to uninstall"* ]]
  [ ! -s "$FAKE_LOG" ]
}

# --- the scripts themselves ------------------------------------------------

@test "shellcheck -s sh finds nothing in the scripts or the stubs" {
  command -v shellcheck >/dev/null || skip "shellcheck not installed"
  run shellcheck -s sh "$CLI" "$INSTALLER" "$STUBS"/*
  [ "$status" -eq 0 ] || { echo "$output"; return 1; }
}
