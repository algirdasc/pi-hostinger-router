import { appendFileSync, readFileSync, writeFileSync } from "fs";

const baseUrl = "https://router.hostinger.com/v1";
const cachePath = process.env.HOME + "/.pi/agent/hostinger-router-models.json";
const authPath = process.env.HOME + "/.pi/agent/auth.json";
const debugLogPath = process.env.HOME + "/.pi/agent/hostinger-router-debug.log";

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
    .filter((m) => !m.supported_endpoints || m.supported_endpoints.some((e) => e.includes("chat") || e.includes("responses")))
    .filter((m) => !m.expiration_date || new Date(m.expiration_date) > new Date())
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
      // prefer /v1/responses over the deprecated /v1/chat/completions when supported
      api: (m.supported_endpoints || []).some((e) => e.includes("responses")) ? "openai-responses" : "openai-completions",
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

// lone UTF-16 surrogates (e.g. a truncated emoji) serialize to JSON that strict servers reject as "Invalid JSON body"
function findLoneSurrogates(value, path = "$", hits = []) {
  if (hits.length >= 20) return hits;
  if (typeof value === "string") {
    const m = value.match(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    if (m) hits.push(path + " @" + m.index + ": …" + JSON.stringify(value.slice(Math.max(0, m.index - 40), m.index + 40)) + "…");
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findLoneSurrogates(v, path + "[" + i + "]", hits));
  } else if (value && typeof value === "object") {
    for (const k of Object.keys(value)) findLoneSurrogates(value[k], path + "." + k, hits);
  }
  return hits;
}

// opt-in request/response logging: `/hostinger-debug on|off` or HOSTINGER_ROUTER_DEBUG=1
function registerDebug(pi) {
  let enabled = /^(1|true|on|yes)$/i.test(process.env.HOSTINGER_ROUTER_DEBUG || "");
  const ours = (ctx) => ctx?.model?.provider === "hostinger-router";
  const log = (title, body) => {
    try {
      appendFileSync(debugLogPath, "=== " + new Date().toISOString() + " " + title + " ===\n" + body + "\n\n");
    } catch {}
  };

  pi.registerCommand?.("hostinger-debug", {
    description: "Toggle Hostinger Router request/response logging (on|off|status)",
    getArgumentCompletions: (prefix) => ["on", "off", "status"].filter((v) => v.startsWith(prefix)).map((v) => ({ value: v, label: v })),
    handler: async (args, ctx) => {
      const arg = (args || "").trim().toLowerCase();
      if (arg === "on") enabled = true;
      else if (arg === "off") enabled = false;
      else if (arg !== "status") enabled = !enabled;
      ctx.ui.notify("Hostinger Router debug " + (enabled ? "ON → " + debugLogPath : "OFF"), "info");
    },
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!enabled || !ours(ctx)) return;
    let body;
    try {
      body = JSON.stringify(event.payload, null, 2);
    } catch (e) {
      body = "<payload not serializable: " + e.message + ">";
    }
    const lone = findLoneSurrogates(event.payload);
    const warn = lone.length ? "!! lone UTF-16 surrogates found (likely cause of 'Invalid JSON body'):\n  " + lone.join("\n  ") + "\n" : "";
    log("REQUEST " + ctx.model.id + " (" + ctx.model.api + ", " + (body?.length ?? 0) + " chars)", warn + body);
  });

  pi.on("after_provider_response", (event, ctx) => {
    if (!enabled || !ours(ctx)) return;
    log("RESPONSE " + event.status, JSON.stringify(event.headers, null, 2));
  });

  pi.on("message_end", (event, ctx) => {
    const msg = event.message;
    if (!enabled || !ours(ctx) || msg?.role !== "assistant" || !msg.errorMessage) return;
    log("ERROR " + (msg.stopReason || ""), msg.errorMessage);
  });
}

// ponytail: disk cache for instant startup; live refresh happens on session_start and whenever the model selector opens
export default async function (pi) {
  registerDebug(pi);
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
