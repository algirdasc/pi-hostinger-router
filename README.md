# pi-hostinger-router

[Hostinger Router](https://router.hostinger.com) provider for [pi](https://pi.dev). Registers the full chat model catalog (~150 models: Claude, GPT, Gemini, Grok, Kimi, DeepSeek, …) with:

- **Live catalog** — models fetched from `GET /v1/models`, refreshed on session start and every time the model selector opens
- **Vision / reasoning detection** — from `architecture.input_modalities` and `supported_parameters`
- **USD cost tracking** — router credits converted at 1 credit = $0.01, so pi's footer matches the Hostinger dashboard
- **Instant startup** — catalog cached at `~/.pi/agent/hostinger-router-models.json`

## Install

```bash
pi install git:github.com/<you>/pi-hostinger-router@v1
# or
pi install npm:pi-hostinger-router
# or try without installing:
pi -e /path/to/pi-hostinger-router
```

## Auth

Either set the env var:

```bash
export HOSTINGER_ROUTER_API_KEY=sk-hstgr-...
```

or run `/login hostinger-router` inside pi (stored in `~/.pi/agent/auth.json`).

Then `/model` and pick anything `hostinger-router`.

## Notes

- Only chat models are registered; audio/image/embedding-only models and expired models are filtered out.
- Picker shows model IDs (`kimi-k3`), not display names — that's pi's UI, but fuzzy search matches display names too (`kimi k3` works).
- Non-chat endpoints (`/v1/embeddings`, `/v1/images`, …) are not wired up.

## Test

```bash
node test/hostinger-router.test.mjs
```
