import type { Model } from "@earendil-works/pi-ai/compat";

export function makeCodexModel(): Model<"openai-codex-responses"> {
  return {
    id: "gpt-5.5",
    name: "GPT 5.5",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
    contextWindow: 272_000,
    maxTokens: 128_000,
  };
}
