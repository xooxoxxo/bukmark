# Security

bukmark runs on your own server and holds your bookmarks, a password hash,
session and access tokens, and the saved text of pages. Problems that expose
any of those are the ones to report.

## Reporting

Report privately through GitHub:
[Report a vulnerability](https://github.com/xooxoxxo/bukmark/security/advisories/new).
Please do not open a public issue.

Include what an attacker needs (network access, a logged-in session, a
malicious page to save…), the steps, and the version. You will get an answer
within a week. Once a fix is released, the advisory is published with credit,
unless you prefer otherwise.

## Supported versions

Fixes go into the latest release only. `bukmark update`, or pulling the
newest `ghcr.io/xooxoxxo/bukmark` image, gets them.

## Scope

In scope: the server and web app, the browser extension, the MCP server, the
`bukmark` command and its installer.

Out of scope: a server reachable from the internet without HTTPS, a database
published beyond localhost with the default password, and anything that needs
control of the machine bukmark runs on.
