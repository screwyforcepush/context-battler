# Azure LLM — Endpoint, Auth, Calling Convention

Operational reference for talking to the project's Azure-hosted LLM. **Verified working 2026-05-07.**

> ⚠️ This is Azure's **Responses API** (`/openai/responses`), not the older Chat Completions API. The request shape and auth header are different from `openai`-SDK defaults. Read the gotchas before wiring it into code.

---

## 1. Credentials (in `.env`)

```
AZURE_API_KEY=<key>
AZURE_URI=https://webfoundtrack.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview
AZURE_MODEL=gpt-5.4-mini
```

- `AZURE_URI` is fully qualified — endpoint **+** path **+** `api-version`. Don't split it.
- `AZURE_MODEL` is the **Azure deployment name**, not a generic model id. Pass it through as-is.
- `.env` is gitignored. Never commit these values.

## 2. Gotchas (read before coding)

1. **Responses API ≠ Chat Completions.** The path is `/openai/responses`, request body uses `input`, response body uses `output[].content[].text`. The `openai` SDK's default chat-completions helpers won't fit.
2. **Auth header is `api-key: <key>`** — Azure-style. Not `Authorization: Bearer ...`.
3. **`api-version` lives in the URL**, not a header. Pinned to `2025-04-01-preview`.
4. **`input` accepts two forms:** a plain string, or an array of `{role, content}` messages. Use the array form for multi-turn / system-prompted calls.
5. **Reasoning is opt-in.** This deployment defaults to `reasoning.effort: "none"`. Set it explicitly if you want reasoning tokens — they bill separately under `usage.output_tokens_details.reasoning_tokens`.
6. **Content filters are always on** and visible in the response (`content_filters[]`). Check `blocked` before trusting `output`.

## 3. Smoke test (copy-pasteable)

```bash
set -a; source .env; set +a
curl -sS -X POST "$AZURE_URI" \
  -H "Content-Type: application/json" \
  -H "api-key: $AZURE_API_KEY" \
  -d "{\"model\":\"$AZURE_MODEL\",\"input\":\"Reply with exactly: pong\"}"
```

Expected: HTTP 200, `output[0].content[0].text === "pong"`.

## 4. Multi-turn / system-prompt form

```bash
curl -sS -X POST "$AZURE_URI" \
  -H "Content-Type: application/json" \
  -H "api-key: $AZURE_API_KEY" \
  -d '{
    "model": "'"$AZURE_MODEL"'",
    "input": [
      {"role": "system", "content": "You are terse."},
      {"role": "user",   "content": "In one word: ready?"}
    ]
  }'
```

## 5. Response shape (the bits you actually read)

```jsonc
{
  "status": "completed",            // also: "incomplete", "failed"
  "model": "gpt-5.4-mini",
  "output": [{
    "type": "message",
    "role": "assistant",
    "content": [{ "type": "output_text", "text": "..." }]
  }],
  "usage": {
    "input_tokens":  11,
    "output_tokens": 5,
    "output_tokens_details": { "reasoning_tokens": 0 },
    "total_tokens":  16
  },
  "content_filters": [ /* check .blocked on each */ ]
}
```

Extract the assistant text with `response.output[0].content[0].text`. Always check `status === "completed"` and `incomplete_details === null` first.

## 6. Useful knobs

| Knob | Where | Notes |
|---|---|---|
| `temperature` | body | Default `1.0`. Lower for deterministic agent decisions. |
| `top_p` | body | Default `0.98`. |
| `max_output_tokens` | body | Cap output length. |
| `reasoning.effort` | body | `"none"` \| `"low"` \| `"medium"` \| `"high"`. Default `"none"` on this deployment. |
| `text.format` | body | Set to `{ "type": "json_object" }` for structured output. |
| `previous_response_id` | body | Server-side conversation chaining (avoids re-sending history). |
| `store` | body | Default `true` — responses are retained server-side. Set `false` for ephemeral calls. |

## 7. Tool use (function calling) — verified working

Tool use round-trips on this deployment. The shape is **different from Chat Completions** — tool definitions are flatter, and the continuation uses `function_call_output` items, not `tool` role messages.

### Tool definition (flat, no `function:` wrapper)

```jsonc
"tools": [{
  "type": "function",
  "name": "get_weather",
  "description": "Get current weather for a city.",
  "parameters": {                 // standard JSON Schema
    "type": "object",
    "properties": {
      "city":  { "type": "string" },
      "units": { "type": "string", "enum": ["celsius", "fahrenheit"] }
    },
    "required": ["city"],
    "additionalProperties": false
  }
}],
"tool_choice": "auto"             // or "required", or { "type":"function", "name":"get_weather" }
```

### Turn 1 — model asks to call the tool

`output[]` contains a `function_call` item instead of a `message`:

```jsonc
{
  "id": "resp_xxx",                              // capture this for turn 2
  "output": [{
    "type": "function_call",
    "name": "get_weather",
    "call_id": "call_yyy",                       // capture this for turn 2
    "arguments": "{\"city\":\"Tokyo\",\"units\":\"celsius\"}"   // ← JSON-encoded STRING
  }]
}
```

Two gotchas:
- `arguments` is a **JSON-encoded string**, not an object. `JSON.parse()` it before using.
- The model can emit **multiple** `function_call` items in one turn (parallel tool calls). Iterate `output[]`, don't index `[0]`.

### Turn 2 — send the tool result back

Use `previous_response_id` to avoid re-sending the conversation. `input[]` is just the tool outputs:

```jsonc
{
  "model": "<deployment>",
  "previous_response_id": "resp_xxx",
  "input": [{
    "type": "function_call_output",
    "call_id": "call_yyy",
    "output": "{\"city\":\"Tokyo\",\"temp_c\":18,\"condition\":\"light rain\"}"   // also a STRING
  }]
}
```

The model then produces a normal `message` in `output[]` synthesizing the result.

### Loop shape (pseudocode)

```
resp = call(initial_input, tools)
while resp has function_call items in output:
    tool_outputs = [
        { type: "function_call_output", call_id: c.call_id,
          output: JSON.stringify(run_tool(c.name, JSON.parse(c.arguments))) }
        for c in resp.output if c.type == "function_call"
    ]
    resp = call(input=tool_outputs, previous_response_id=resp.id, tools=tools)
return resp.output[<message>].content[0].text
```

### Tool-use gotchas (project-relevant)

- **Decision contract for the agent loop should be a tool, not a JSON-mode response.** Tool calls give you typed args and a `call_id` you can log to the scratchpad. JSON-mode loses both.
- **`tool_choice: "required"`** forces the model to call *some* tool. Useful for the per-turn agent decision where free-form text would be a bug.
- **Parallel tool calls must be off.** Set `parallel_tool_calls: false`. The decision contract is *one tool call per turn*, all action fields bundled (see `architecture.md` §3 and mental model §9). The schema disallows even expressing parallel turns.
- **Tool `output` is a string.** Stringify your JSON before sending.

### Scope of `previous_response_id`

`previous_response_id` is fine for **tool-result roundtrips within a single turn** — that's what the loop above uses it for. It is **not** safe to chain across game turns.

Game turns are *stateless-per-turn calls* by design (`mental-model.md` §9, `concept-spec.md` §2A.1, `architecture.md` §3). Each turn is a fresh prompt assembled from the visible state and the agent's scratchpad — that is the agent's only memory across turns. Using `previous_response_id` to chain turn-N's response to turn-N+1 would smuggle hidden conversation history past the scratchpad-only-memory invariant and break the explainability layer.

Rule of thumb: **`previous_response_id` lives within a turn; never between turns.**

## 8. When this guide goes stale

- Endpoint changes (new region, new resource): update `.env`, re-run §3, bump the verified date above.
- Model swap: only `AZURE_MODEL` changes; the API contract is the same.
- API-version bump: re-run §3 against the new version before flipping `AZURE_URI` in `.env`.
