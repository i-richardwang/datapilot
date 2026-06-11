# server-core

- **Runtime-neutral invariant**: this package runs under BOTH Bun (standalone `bun run`) and Node (Docker image, see `Dockerfile.server` CMD; bundled via `scripts/build-server-node.ts`). Never call Bun-only APIs (`Bun.file`, `Bun.serve`, `Bun.password`, …) without a runtime guard — prefer the `node:` equivalent, which works under both runtimes in a single code path. Exception: `startWebuiHttpServer` (webui/http-server.ts) is a Bun-only standalone wrapper used by tests; production traffic goes through `createWebuiHandler` + `webui/node-adapter.ts`.
- The Docker server runs under Node specifically so the real `ws` package negotiates permessage-deflate — Bun's ws shim silently ignores `perMessageDeflate`. Don't "simplify" the Docker CMD back to `bun run`.
