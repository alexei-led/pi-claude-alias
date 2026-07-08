import assert from "node:assert/strict";
import test from "node:test";
import type {
  Model,
  OAuthCredentials,
  OAuthLoginCallbacks,
} from "@earendil-works/pi-ai/compat";
import {
  formatFooterModelLabel,
  getAliasOAuthName,
  getFooterStatusText,
  registerAnthropicAlias,
  registerClaudeAliases,
  resolveBuiltinAnthropicModels,
} from "../src/index.js";
import type { ClaudeAliasDefinition } from "../src/config.js";
import { FakePi, type FakeModelRegistry } from "./support/fake-pi.js";

type AnthropicModel = Model<"anthropic-messages">;

test("registers config-driven aliases with the expected provider ids and login names", () => {
  const pi = new FakePi();
  const aliases = [
    makeAlias({ slug: "work", handle: "claude-work", label: "Work" }),
    makeAlias({ slug: "labs", handle: "claude-labs", label: "Labs" }),
  ];

  registerClaudeAliases(pi.asExtensionApi(), {
    getModels: () => [makeModel()],
    oauthProvider: createOAuthProvider("Anthropic (Claude Pro/Max)"),
    loadAliases: () => ({ aliases, errors: [] }),
  });

  assert.deepEqual([...pi.providers.keys()].sort(), [
    "anthropic-labs",
    "anthropic-work",
  ]);
  assert.equal(
    pi.providers.get("anthropic-work")?.oauth?.name,
    "Anthropic (Claude Pro/Max) - Work",
  );
  assert.equal(
    pi.providers.get("anthropic-labs")?.oauth?.name,
    "Anthropic (Claude Pro/Max) - Labs",
  );
});

test("copies Anthropic models and preserves metadata", () => {
  const pi = new FakePi();
  const alias = makeAlias({
    slug: "work",
    handle: "claude-work",
    label: "Work",
  });
  const sourceModel = makeModel({
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    thinkingLevelMap: { off: null, xhigh: "max" },
    headers: { "x-test": "1" },
    compat: { forceAdaptiveThinking: true, allowEmptySignature: true },
  });

  registerAnthropicAlias(
    pi.asExtensionApi(),
    alias,
    createOAuthProvider("Anthropic (Claude Pro/Max)"),
    [sourceModel],
  );

  const aliasModel = pi.providers.get(alias.providerId)?.models?.[0];
  assert.ok(aliasModel);
  assert.equal(aliasModel.id, sourceModel.id);
  assert.equal(aliasModel.name, "Claude Opus 4.8 (Work)");
  assert.equal(aliasModel.api, sourceModel.api);
  assert.equal(aliasModel.baseUrl, sourceModel.baseUrl);
  assert.equal(aliasModel.reasoning, sourceModel.reasoning);
  assert.deepEqual(aliasModel.input, sourceModel.input);
  assert.deepEqual(aliasModel.cost, sourceModel.cost);
  assert.equal(aliasModel.contextWindow, sourceModel.contextWindow);
  assert.equal(aliasModel.maxTokens, sourceModel.maxTokens);
  assert.deepEqual(aliasModel.thinkingLevelMap, sourceModel.thinkingLevelMap);
  assert.deepEqual(aliasModel.headers, sourceModel.headers);
  assert.deepEqual(aliasModel.compat, sourceModel.compat);

  assert.notStrictEqual(aliasModel.input, sourceModel.input);
  assert.notStrictEqual(aliasModel.cost, sourceModel.cost);
  assert.notStrictEqual(
    aliasModel.thinkingLevelMap,
    sourceModel.thinkingLevelMap,
  );
  assert.notStrictEqual(aliasModel.headers, sourceModel.headers);
  assert.notStrictEqual(aliasModel.compat, sourceModel.compat);
});

test("uses model registry overrides when refreshing source models", () => {
  const baseModel = makeModel({ id: "claude-sonnet-4-6", maxTokens: 64_000 });
  const overrideModel = makeModel({
    id: "claude-sonnet-4-6",
    maxTokens: 32_000,
    headers: { "x-override": "1" },
  });
  const modelRegistry: FakeModelRegistry = {
    find(provider, modelId) {
      return provider === "anthropic" && modelId === baseModel.id
        ? overrideModel
        : undefined;
    },
  };

  const resolved = resolveBuiltinAnthropicModels(
    {
      getModels: () => [baseModel],
      oauthProvider: createOAuthProvider("Anthropic (Claude Pro/Max)"),
      loadAliases: () => ({ aliases: [], errors: [] }),
    },
    modelRegistry,
  );

  assert.deepEqual(resolved, [overrideModel]);
});

test("registers oauth-capable aliases even when the built-in catalog is empty", () => {
  const pi = new FakePi();
  const aliases = [
    makeAlias({ slug: "work", handle: "claude-work", label: "Work" }),
  ];

  registerClaudeAliases(pi.asExtensionApi(), {
    getModels: () => [],
    oauthProvider: createOAuthProvider("Anthropic (Claude Pro/Max)"),
    loadAliases: () => ({ aliases, errors: [] }),
  });

  const work = pi.providers.get("anthropic-work");
  assert.ok(work);
  assert.deepEqual(work.models, []);
  assert.equal(work.oauth?.name, "Anthropic (Claude Pro/Max) - Work");
});

test("updates footer status with alias handle and short model name", () => {
  const pi = new FakePi();
  const aliases = [
    makeAlias({ slug: "work", handle: "claude-work", label: "Work" }),
  ];
  const ctx = pi.createContext({
    model: { provider: "anthropic-work", id: "claude-opus-4-8" },
  });

  registerClaudeAliases(pi.asExtensionApi(), {
    getModels: () => [makeModel()],
    oauthProvider: createOAuthProvider("Anthropic (Claude Pro/Max)"),
    loadAliases: () => ({ aliases, errors: [] }),
  });
  pi.emit("session_start", ctx);

  assert.equal(ctx.ui.lastStatus("claude-alias"), "claude-work · opus-4.8");
});

test("unregisters stale providers when alias config changes", () => {
  const pi = new FakePi();
  let aliases = [
    makeAlias({ slug: "work", handle: "claude-work", label: "Work" }),
  ];
  const ctx = pi.createContext();

  registerClaudeAliases(pi.asExtensionApi(), {
    getModels: () => [makeModel()],
    oauthProvider: createOAuthProvider("Anthropic (Claude Pro/Max)"),
    loadAliases: () => ({ aliases, errors: [] }),
  });
  assert.ok(pi.providers.has("anthropic-work"));

  aliases = [];
  pi.emit("before_agent_start", ctx);

  assert.equal(pi.providers.has("anthropic-work"), false);
  assert.deepEqual(pi.unregisteredProviderIds, ["anthropic-work"]);
});

test("builds footer text only for active configured aliases", () => {
  const aliases = [
    makeAlias({ slug: "work", handle: "claude-work", label: "Work" }),
  ];

  assert.equal(
    getFooterStatusText(
      { provider: "anthropic-work", id: "claude-opus-4-5-20251101" },
      aliases,
    ),
    "claude-work · opus-4.5@20251101",
  );
  assert.equal(
    getFooterStatusText(
      { provider: "anthropic", id: "claude-opus-4-8" },
      aliases,
    ),
    undefined,
  );
});

test("formats alias oauth labels and footer model labels", () => {
  assert.equal(
    getAliasOAuthName("Anthropic (Claude Pro/Max)", "Work"),
    "Anthropic (Claude Pro/Max) - Work",
  );
  assert.equal(formatFooterModelLabel("claude-opus-4-8"), "opus-4.8");
  assert.equal(formatFooterModelLabel("claude-opus-4-10"), "opus-4.10");
  assert.equal(
    formatFooterModelLabel("claude-opus-4-5-20251101"),
    "opus-4.5@20251101",
  );
});

function makeAlias(
  overrides: Partial<ClaudeAliasDefinition>,
): ClaudeAliasDefinition {
  const slug = overrides.slug ?? "work";
  return {
    slug,
    providerId: overrides.providerId ?? `anthropic-${slug}`,
    handle: overrides.handle ?? `claude-${slug}`,
    label: overrides.label ?? "Work",
  };
}

function makeModel(overrides: Partial<AnthropicModel> = {}): AnthropicModel {
  return {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200_000,
    maxTokens: 64_000,
    thinkingLevelMap: { xhigh: "max" },
    ...overrides,
  };
}

function createOAuthProvider(name: string) {
  return {
    name,
    login(_callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
      return Promise.resolve({
        refresh: "refresh-token",
        access: "access-token",
        expires: 4_102_444_800_000,
      });
    },
    refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
      return Promise.resolve(credentials);
    },
    getApiKey(credentials: OAuthCredentials): string {
      return String(credentials.access);
    },
  };
}
