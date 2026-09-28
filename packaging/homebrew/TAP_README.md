# homebrew-tap

Homebrew formulae for [bukmark](https://bukmark.it), a self-hosted bookmark
manager.

## Install

```sh
brew install xooxoxxo/tap/bukmark
bukmark setup
```

`bukmark setup` pulls the bukmark image, starts it with its database, and
prints the address to open. Open it and set a password. Your data lives in
`~/.bukmark`.

## You need Docker

bukmark runs in Docker. Homebrew installs the `bukmark` command, not Docker.
You need Docker with Compose v2, and it has to be running:

- macOS: any one of
  - OrbStack: `brew install --cask orbstack`
  - Docker Desktop: `brew install --cask docker-desktop`
  - Colima: `brew install colima docker docker-compose`, follow the note that
    `brew info docker-compose` prints, then `colima start`
- Linux: Docker Engine with the Compose plugin, from your distribution or
  <https://docs.docker.com/engine/install/>

## Update

```sh
brew upgrade bukmark   # the bukmark command
bukmark update         # the server: pulls the new image and keeps your data
```

## Remove

```sh
bukmark uninstall      # stops bukmark and keeps your data
brew uninstall bukmark
```

To delete your bookmarks as well, run `bukmark uninstall --delete-data` before
`brew uninstall`. It asks you to confirm.

## Tap trust

Homebrew 6 loads formulae from a tap like this one only when you trust them.
Installing by the full name, `xooxoxxo/tap/bukmark`, trusts that one formula.
To install by the short name after `brew tap xooxoxxo/tap`, trust it first:

```sh
brew trust --formula xooxoxxo/tap/bukmark
```

## Other ways to install

The install script and Docker Compose from source are described in the
[install guide](https://bukmark.it/docs/install/).

## For maintainers

`Formula/bukmark.rb` comes from `packaging/homebrew/bukmark.rb` in the bukmark
repository. After a release is tagged there, run
`packaging/homebrew/update-formula.sh <version>` in that repository, copy the
result to `Formula/bukmark.rb` here, and check it:

```sh
brew install xooxoxxo/tap/bukmark
brew test xooxoxxo/tap/bukmark
brew audit --strict --online xooxoxxo/tap/bukmark
```
