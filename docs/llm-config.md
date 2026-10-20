# LLM configuration

The repo talks to one adapter against any OpenAI-compatible chat-completions
endpoint. Both Gemini and local Ollama expose that shape, so switching
backends is a config change, not a code change. See
`src/lib/adapters/llm/ai-sdk.ts` and `src/lib/composition.ts`.

## Fall-through at composition time

1. `GEMINI_API_KEY` is set AND `LLM_PROVIDER` is not `ollama` -> Gemini
   (baseURL `https://generativelanguage.googleapis.com/v1beta/openai`).
2. Local Ollama responds at `${OLLAMA_BASE_URL}/v1/models` within 1500 ms
   AND the user explicitly set `LLM_PROVIDER=ollama` -> Ollama
   (baseURL `${OLLAMA_BASE_URL}/v1`, dummy api key).
3. Else -> `LlmNotConfiguredError` at composition time. No silent mock.

The reachability probe is non-blocking (1500 ms, catches every failure),
and is only run when the pre-conditions for branch 2 apply.

## Running against Gemini (default)

```
# .env.local
GEMINI_API_KEY=<your key>
LLM_MODEL=gemini-3.1-flash-lite   # optional, this is the default
```

Start the server: `npm run dev`. `/api/health` reports
`llm.provider: "gemini"`.

## Running against local Ollama during development

Install Ollama locally, pull a model, keep the server running:

```
ollama pull qwen3:8b
ollama serve   # usually auto-started
```

Then in `.env.local`:

```
LLM_PROVIDER=ollama
LLM_MODEL=qwen3:8b
# Optional (default shown):
# OLLAMA_BASE_URL=http://127.0.0.1:11434
# LLM_TIMEOUT_MS=120000     # local models are slower than hosted ones
# AGENT_DEADLINE_MS=300000
```

Nothing else changes: the adapter speaks OpenAI chat-completions to Ollama's
`/v1` endpoint, so prompts, schemas and cache keys are identical. `/api/health`
reports `llm.provider: "ollama"` once the composition probe succeeds.

## Behind a proxy or custom OpenAI-compat gateway

```
LLM_BASE_URL_OVERRIDE=https://your-gateway.example.com/openai
LLM_MODEL=<whatever your gateway serves>
GEMINI_API_KEY=<any value the gateway requires>
```

The override short-circuits the derived base URL. The adapter still logs
only the host (never the path or key) so you can tell which backend
served a given call without leaking secrets.
