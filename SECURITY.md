# Security policy

RAP Studio runs code on your machine: ABAP you write is compiled to JavaScript and executed, and the studio can start
your local AI command line tool to build apps. Treat it like any development server.

## Running it safely

- By default the studio (`rap studio`) and `rap serve` listen on 127.0.0.1 only and answer only for `localhost` /
  `127.0.0.1`. Requests that other web sites make from your browser are refused.
- `--host 0.0.0.0` (or another address) makes it reachable from other machines. Create an administrator first
  (`rap user apps <name> --password <pw> --admin`): without users, anyone who can reach it can build and run code.
- Once users exist, every request needs a logon, and only administrators use the studio and the development functions
  of an app.
- The classic ABAP engine of each app listens on 127.0.0.1 on its own port. With users, it runs every browser request as
  the user logged on to the studio (a signed cookie; the key is `apps/.rap-secret`) and refuses browsers without that
  logon. Local tools on the machine (the `rap` command line) run as the engine's user. Do not expose its port.
- Users and password hashes are in `apps/.rap-users.json` (readable by its owner only). Do not commit it.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability reporting
("Security" → "Report a vulnerability") on https://github.com/NabheetCloud/ABAP-Runtime, with the steps to
reproduce and the version (`rap --version`). You will get an answer within a week.

Fixes go into the latest release only.
