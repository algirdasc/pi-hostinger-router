import assert from "node:assert";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HOME = mkdtempSync(join(tmpdir(), "hostinger-router-"));
mkdirSync(join(process.env.HOME, ".pi/agent"), { recursive: true });
process.env.HOSTINGER_ROUTER_API_KEY = "test-key";

const payload = {
  data: [
    {
      id: "gpt-x",
      name: "GPT X",
      context_length: 128000,
      max_output_tokens: 64000,
      pricing: { prompt: "0.00025", completion: "0.002", input_cache_read: "0.000025", input_cache_write: "0.0003", input_cache_write_1h: "0.0005" },
      supported_parameters: ["temperature", "reasoning_effort"],
    },
    {
      id: "vision-y",
      name: "Vision Y",
      context_length: 8192,
      pricing: { prompt: "0.0001", completion: "0.0004", input_cache_read: "0", input_cache_write: "0", input_cache_write_1h: "0" },
      supported_parameters: ["temperature"],
      architecture: { input_modalities: ["text", "image"] },
      supported_endpoints: ["/v1/chat/completions"],
    },
    {
      id: "tts-z",
      name: "TTS Z",
      pricing: { prompt: "0", completion: "0", input_cache_read: "0", input_cache_write: "0", input_cache_write_1h: "0" },
      supported_endpoints: ["/v1/audio/speech"],
    },
    {
      id: "dead-model",
      name: "Dead",
      pricing: { prompt: "0", completion: "0", input_cache_read: "0", input_cache_write: "0", input_cache_write_1h: "0" },
      expiration_date: "2020-01-01",
    },
  ],
};

global.fetch = async () => ({ ok: true, json: async () => payload });

const ext = (await import("../extensions/hostinger-router.ts")).default;

let registered;
await ext({ registerProvider: (name, cfg) => (registered = cfg), on() {} });

const [gpt, vision] = registered.models;
assert.equal(registered.models.length, 2, "audio-only and expired models filtered out");
assert.equal(gpt.reasoning, true);
assert.deepEqual(gpt.input, ["text"]);
assert.equal(gpt.cost.input, 2.5, "0.00025 credits/token = $2.50 per 1M");
assert.equal(gpt.cost.output, 20);
assert.equal(gpt.cost.cacheRead, 0.25);
assert.equal(gpt.cost.cacheWrite, 3);
assert.deepEqual(vision.input, ["text", "image"]);
assert.equal(gpt.maxTokens, 64000);
assert.equal(vision.maxTokens, 4096);

assert.equal(await registered.refreshModels({ allowNetwork: false }), undefined);
const refreshed = await registered.refreshModels({ allowNetwork: true, credential: { type: "api_key", key: "k" } });
assert.equal(refreshed.length, 2);
const viaEnv = await registered.refreshModels({ allowNetwork: true });
assert.equal(viaEnv.length, 2, "falls back to env key");
delete process.env.HOSTINGER_ROUTER_API_KEY;
assert.equal(await registered.refreshModels({ allowNetwork: true }), undefined, "no key anywhere, no refresh");

global.fetch = async () => { throw new Error("second run must use cache"); };
let fromCache;
await ext({ registerProvider: (name, cfg) => (fromCache = cfg), on() {} });
assert.equal(fromCache.models.length, 2);

console.log("ok");
