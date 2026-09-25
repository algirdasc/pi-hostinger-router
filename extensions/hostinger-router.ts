import { readFileSync, writeFileSync } from "fs";

const baseUrl = "https://router.hostinger.com/v1";
const cachePath = process.env.HOME + "/.pi/agent/hostinger-router-models.json";
const authPath = process.env.HOME + "/.pi/agent/auth.json";

// $1 = 100 credits on the Hostinger dashboard; pi's footer shows $
const dollarsPerMillionTokens = (creditsPerToken) => Math.round(Number(creditsPerToken || 0) * 10000 * 1e6) / 1e6;

function resolveApiKey() {
  if (process.env.HOSTINGER_ROUTER_API_KEY) return process.env.HOSTINGER_ROUTER_API_KEY;
  try {
    return JSON.parse(readFileSync(authPath, "utf8"))["hostinger-router"]?.key;
  } catch {}
}

async function fetchModels(apiKey) {
  const res = await fetch(baseUrl + "/models", {
    headers: { Authorization: "Bearer " + apiKey },
  });
  if (!res.ok) throw new Error("models fetch failed: " + res.status);
  const payload = await res.json();
  const models = (payload.data || [])
    .filter((m) => !m.supported_endpoints || m.supported_endpoints.some((e) => e.includes("chat")))
    .filter((m) => !m.expiration_date || new Date(m.expiration_date) > new Date())
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
      reasoning: (m.supported_parameters || []).some((p) => p.startsWith("reasoning")),
      input: m.architecture?.input_modalities?.includes("image") ? ["text", "image"] : ["text"],
      cost: {
        input: dollarsPerMillionTokens(m.pricing?.prompt),
        output: dollarsPerMillionTokens(m.pricing?.completion),
        cacheRead: dollarsPerMillionTokens(m.pricing?.input_cache_read),
        cacheWrite: dollarsPerMillionTokens(m.pricing?.input_cache_write), // 1h cache tier ignored, pi has no slot for it
      },
      contextWindow: m.context_length || 128000,
      maxTokens: m.max_output_tokens || 4096, // max_output_tokens is live-only, not in the spec
    }));
  if (models.length === 0) throw new Error("no chat models returned");
  return models;
}

function register(pi, models) {
  pi.registerProvider("hostinger-router", {
    name: "Hostinger Router",
    baseUrl: baseUrl,
    apiKey: "$HOSTINGER_ROUTER_API_KEY",
    api: "openai-completions",
    models: models,
    refreshModels: async (context) => {
      if (!context.allowNetwork) return undefined;
      const key = context.credential?.type === "api_key" ? context.credential.key : resolveApiKey();
      if (!key) return undefined;
      const fresh = await fetchModels(key);
      try {
        writeFileSync(cachePath, JSON.stringify(fresh));
      } catch {}
      return fresh;
    },
  });
}

// ponytail: disk cache for instant startup; live refresh happens on session_start and whenever the model selector opens
export default async function (pi) {
  let models = null;
  try {
    models = JSON.parse(readFileSync(cachePath, "utf8"));
  } catch {}

  if (models) {
    register(pi, models); // instant startup from cache
    pi.on("session_start", async () => {
      const apiKey = resolveApiKey();
      if (!apiKey) return;
      try {
        writeFileSync(cachePath, JSON.stringify(await fetchModels(apiKey)));
      } catch {}
    });
    return;
  }

  const apiKey = resolveApiKey();
  if (!apiKey) {
    register(pi, []); // no key yet: register empty so /login lists the provider
    return;
  }
  try {
    models = await fetchModels(apiKey);
  } catch (e) {
    console.error("[hostinger-router] " + e.message);
    register(pi, []);
    return;
  }
  writeFileSync(cachePath, JSON.stringify(models));
  register(pi, models);
}
