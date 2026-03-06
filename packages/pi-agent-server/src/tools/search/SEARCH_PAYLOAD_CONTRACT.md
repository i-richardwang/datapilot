# Search Payload Contract

Last updated: 2026-03-03

This file documents the **known-good request shape** for provider-native web search calls in `pi-agent-server`.

## ChatGPT backend (openai-codex)

Implementation: [providers/chatgpt.ts](./providers/chatgpt.ts)

Endpoint:
- `POST https://chatgpt.com/backend-api/codex/responses`

Required headers:
- `Authorization: Bearer <oauth-access-token>`
- `chatgpt-account-id: <JWT claim https://api.openai.com/auth.chatgpt_account_id>`
- `OpenAI-Beta: responses=experimental`
- `Content-Type: application/json`

Known-good body fields for search (non-streaming JSON parse path):
- `model: "gpt-5.3-codex"`
- `store: false`
- `stream: false`
- `instructions: string`
- `tools: [{ type: "web_search" }]` (fallback retry: `web_search_preview`)
- `tool_choice: "auto"`
- `text: { verbosity: "medium" }`
- `input: string`

### Why `stream: false` here?
This provider consumes `response.json()` and parses the full JSON response. It does **not** consume SSE chunks, so streaming must be disabled explicitly.

## Regression Checklist

If search starts returning HTTP 400 again:
1. Verify this payload shape in tests (`providers/chatgpt.test.ts`).
2. Compare against current upstream SDK behavior (`@mariozechner/pi-ai` codex responses provider).
3. Confirm model remains codex-compatible (`gpt-5.x-codex` family).
4. Inspect error fingerprint in thrown error (`tool/model/stream/tool_choice/text.verbosity`).
