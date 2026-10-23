# pi-hostinger-router

Use [Hostinger Router](https://router.hostinger.com) with [pi](https://pi.dev) — one provider, the full chat model catalog (~150 models: Claude, GPT, Gemini, Grok, Kimi, DeepSeek, …).

- **Always up to date** — the model list is fetched live on session start and every time you open the model selector
- **Vision & reasoning aware** — detected automatically for each model
- **Cost tracking** — pi's footer shows cost in `$` (1$ = 100 credits on your Hostinger dashboard)
- **Instant startup** — the catalog is cached locally at `~/.pi/agent/hostinger-router-models.json`

## Install

```bash
pi install npm:pi-hostinger-router
# or from git
pi install git:github.com/algirdasc/pi-hostinger-router
```

Or try it without installing:

```bash
pi -e git:github.com/algirdasc/pi-hostinger-router
```

## Setup

1. Grab an API key from your Hostinger Router dashboard.
2. In pi, run `/login hostinger-router` and paste the key.
3. Open `/model` and pick any `hostinger-router` model.

That's it — the key is stored in `~/.pi/agent/auth.json`.

### Headless / automation

For scripts and CI where `/login` isn't available, set the key as an environment variable instead:

```bash
export HOSTINGER_ROUTER_API_KEY=sk-hstgr-...
```
