# dtpilot

Thin CLI client for a running [DataPilot](https://github.com/i-richardwang/datapilot) server. The CLI is designed to be driven by external agent tools (Claude Code, Codex, etc.) — every capability is reachable through a uniform `entity action` grammar with flat flags for identity and JSON input for data.

## Install

```bash
npm install -g dtpilot
```

The package is published as `dtpilot` (short form); the installed binary is also `dtpilot`.

Requires **Node.js ≥ 22** (for native `WebSocket` and `crypto.randomUUID`). No runtime dependencies are pulled in.

Verify the install:

```bash
dtpilot --version
dtpilot --help
```

## Connect to a server

The CLI talks to a DataPilot server over WebSocket. It resolves the URL and token in this order:

1. `--url <ws-url>` / `--token <secret>` flags
2. `$DATAPILOT_SERVER_URL` / `$DATAPILOT_SERVER_TOKEN` env vars
3. Discovery file at `~/.datapilot/.server.endpoint` (written by the DataPilot desktop app)
4. Default: `ws://127.0.0.1:9100`

For a DataPilot desktop install the discovery file is written automatically — once the app is running, `dtpilot workspace list` works out of the box. For other setups, point the CLI at your server explicitly:

```bash
export DATAPILOT_SERVER_URL=ws://127.0.0.1:9100
export DATAPILOT_SERVER_TOKEN=...secret...
dtpilot workspace list
```

For self-signed TLS: `--tls-ca <path>` or `$DATAPILOT_TLS_CA`.

## Command shape

```
dtpilot [global-flags] <entity> <action> [positionals...] [flags...]
```

- **Entities** — `workspace`, `session`, `source`, `label`, `skill`, `automation`, `batch`
- **Flat flags** carry only identity or query params: `--name`, `--event`, `--limit`, etc.
- **Data fields go through JSON**: `--input '<json>'` or `--stdin` for payloads

Run `dtpilot <entity>` with no action to list that entity's actions.

## Output

- When stdout is **not a TTY** (piped, captured by an agent), the CLI emits a JSON envelope:
  ```json
  { "ok": true, "data": ..., "warnings": [] }
  ```
- When stdout is a TTY, the CLI renders a human-readable view.
- Force either mode with `--json` / `--human`.

This envelope contract is what makes the CLI agent-friendly — stable, parseable output everywhere an agent plugs in.

## Examples

List workspaces and sessions:

```bash
dtpilot workspace list
dtpilot --workspace <id> session list
```

Create a label:

```bash
dtpilot label create --name TODO --input '{"color":"blue"}'
```

Send a message to an existing session:

```bash
dtpilot session message <session-id> --input '{"text":"summarize yesterday"}'
```

Create an automation:

```bash
dtpilot automation create \
  --name "nightly-recap" \
  --event SchedulerTick \
  --input '{"cron":"0 22 * * *","actions":[{"type":"prompt","prompt":"Post a recap"}]}'
```

## Development

This package is developed inside the [datapilot](https://github.com/i-richardwang/datapilot) monorepo. Inside the repo:

```bash
bun run apps/cli/src/datapilot.ts <entity> <action> ...   # run from source
bun test apps/cli/src/                                    # tests
bun --cwd apps/cli run build                              # produce dist/datapilot.js
```

The published tarball contains only `dist/`, this README, and the license — no source or tests.

## License

Apache-2.0. See [LICENSE](./LICENSE).
