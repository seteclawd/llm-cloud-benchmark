// llm-cloud-benchmark — entrada para Cloudflare Workers.
// Misma API que server.js (Express, VPS): GET /api/models y POST /api/test.
// El resto se sirve desde ./public como assets.

const MODELS = [
  { id: "glm-5.1", name: "GLM-5.1", provider: "ollama" },
  { id: "gpt-oss:120b", name: "GPT-OSS 120B", provider: "ollama" },
  { id: "gpt-oss:20b", name: "GPT-OSS 20B", provider: "ollama" },
  { id: "qwen3.5:122b", name: "Qwen 3.5 122B", provider: "ollama" },
  { id: "qwen3.5:27b", name: "Qwen 3.5 27B", provider: "ollama" },
  { id: "gemma4:31b", name: "Gemma 4 31B", provider: "ollama" },
  { id: "gemma4:26b", name: "Gemma 4 26B", provider: "ollama" },
  { id: "minimax-m2.7", name: "MiniMax M2.7", provider: "ollama" },
  { id: "devstral-small-2", name: "Devstral Small 2", provider: "ollama" },
  { id: "devstral-2", name: "Devstral 2", provider: "ollama" },
  { id: "nemotron-3-super", name: "Nemotron 3 Super", provider: "ollama" },
  { id: "kimi-k2.5", name: "Kimi K2.5", provider: "ollama" },
  { id: "glm-5", name: "GLM-5", provider: "ollama" },
  { id: "qwen3-next:80b", name: "Qwen 3-Next 80B", provider: "ollama" },
  { id: "qwen3-coder-next", name: "Qwen3 Coder Next", provider: "ollama" },
  { id: "minimax-m2.5", name: "MiniMax M2.5", provider: "ollama" },
  { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", provider: "ollama" },
  { id: "deepseek-v3.2", name: "DeepSeek V3.2", provider: "ollama" },
  { id: "glm-4.7", name: "GLM-4.7", provider: "ollama" },
  { id: "nemotron-3-nano:30b", name: "Nemotron 3 Nano 30B", provider: "ollama" },
  { id: "nemotron-3-nano:4b", name: "Nemotron 3 Nano 4B", provider: "ollama" },
  { id: "rnj-1:8b", name: "RNJ-1 8B", provider: "ollama" },
  { id: "cogito-2.1", name: "Cogito 2.1", provider: "ollama" },
  { id: "ministral-3:14b", name: "Ministral 3 14B", provider: "ollama" },
  { id: "gpt-oss-safeguard:120b", name: "GPT-OSS Safeguard 120B", provider: "ollama" },
];

import { isAuthorized, unauthorized } from "./auth.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

async function timed(url, init) {
  const t0 = Date.now();
  const res = await fetch(url, init);
  const ttfb = Date.now() - t0;
  const text = await res.text();
  return { res, text, ttfb, total: Date.now() - t0 };
}

async function testOllama(model, prompt, env) {
  const key = env.OLLAMA_API_KEY || "";
  const { res, text, ttfb, total } = await timed("https://ollama.com/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], stream: false }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${text.slice(0, 120)}`);
  const parsed = JSON.parse(text);
  const evalCount = parsed.eval_count || (parsed.message?.content?.split(" ").length || 0) * 1.3 || 0;
  const evalDuration = parsed.eval_duration ? parsed.eval_duration / 1e9 : total / 1000;
  return {
    ttfb, totalTime: total,
    totalTokens: Math.round(evalCount),
    tokensPerSec: evalDuration ? Math.round((evalCount / evalDuration) * 10) / 10 : 0,
    quality: null,
    response: parsed.message?.content?.substring(0, 200) ?? null,
    raw: parsed,
  };
}

async function testOpenAI(model, prompt, env) {
  const key = env.OPENAI_API_KEY || "";
  if (!key) throw new Error("No OpenAI API key");
  const { res, text, ttfb, total } = await timed("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 200 }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${text.slice(0, 120)}`);
  const parsed = JSON.parse(text);
  const usage = parsed.usage || {};
  const tps = usage.completion_tokens && total > 0 ? usage.completion_tokens / (total / 1000) : 0;
  return {
    ttfb, totalTime: total,
    totalTokens: usage.total_tokens || 0,
    tokensPerSec: Math.round(tps * 10) / 10,
    quality: null,
    response: parsed.choices?.[0]?.message?.content?.substring(0, 200) ?? null,
    raw: parsed,
  };
}

async function testAnthropic(model, prompt, env) {
  const key = env.ANTHROPIC_API_KEY || "";
  if (!key) throw new Error("No Anthropic API key");
  const { res, text, ttfb, total } = await timed("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 200 }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${text.slice(0, 120)}`);
  const parsed = JSON.parse(text);
  const out = parsed.usage?.output_tokens || 0;
  return {
    ttfb, totalTime: total,
    totalTokens: (parsed.usage?.input_tokens || 0) + out,
    tokensPerSec: total > 0 ? Math.round((out / (total / 1000)) * 10) / 10 : 0,
    quality: null,
    response: parsed.content?.[0]?.text?.substring(0, 200) ?? null,
    raw: parsed,
  };
}

export default {
  async fetch(request, env) {
    if (!isAuthorized(request, env)) return unauthorized();

    const url = new URL(request.url);
    if (url.pathname === "/api/models") return json(MODELS);

    if (url.pathname === "/api/test" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "JSON inválido" }, 400);
      }
      const model = MODELS.find((m) => m.id === body.model);
      if (!model) return json({ error: `Model not found: ${body.model}` }, 404);
      const prompt = body.prompt || "Explain the difference between TCP and UDP in 3 sentences.";
      try {
        const result =
          model.provider === "ollama" ? await testOllama(model.id, prompt, env)
          : model.provider === "openai" ? await testOpenAI(model.id, prompt, env)
          : model.provider === "anthropic" ? await testAnthropic(model.id, prompt, env)
          : (() => { throw new Error(`Provider no implementado: ${model.provider}`); })();
        return json(result);
      } catch (e) {
        return json({ error: String(e.message || e), ttfb: null, tokensPerSec: 0, quality: null }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
