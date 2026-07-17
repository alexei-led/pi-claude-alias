import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import * as piAiCompat from "@earendil-works/pi-ai/compat";
import type {
  Model,
  OAuthAuth,
  OAuthCredentials,
  OAuthLoginCallbacks,
} from "@earendil-works/pi-ai/compat";
import {
  loadClaudeAliases,
  type ClaudeAliasDefinition,
  type ClaudeAliasLoadOptions,
  type ClaudeAliasLoadResult,
} from "./config.js";

const BUILTIN_PROVIDER = "anthropic";
const BUILTIN_API = "anthropic-messages";
const BUILTIN_BASE_URL = "https://api.anthropic.com";
const FOOTER_STATUS_KEY = "claude-alias";

type AnthropicModel = Model<typeof BUILTIN_API>;
export interface ClaudeAliasExtensionAPI {
  registerProvider(
    name: string,
    config: Parameters<ExtensionAPI["registerProvider"]>[1],
  ): void;
  unregisterProvider(name: string): void;
  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
}
type ModelRegistryLike = {
  find(provider: string, modelId: string): unknown;
};
type RefreshContext = Pick<
  ExtensionContext,
  "cwd" | "hasUI" | "isProjectTrusted" | "model" | "modelRegistry" | "ui"
>;

type AnthropicOAuthProvider = {
  name: string;
  login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
  refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
  getApiKey(credentials: OAuthCredentials): string;
};

export type AnthropicAliasDeps = {
  getModels(provider: string): readonly unknown[];
  oauthProvider: AnthropicOAuthProvider;
  loadAliases(options: ClaudeAliasLoadOptions): ClaudeAliasLoadResult;
};

const defaultGetModels: AnthropicAliasDeps["getModels"] = (provider) =>
  provider === BUILTIN_PROVIDER ? piAiCompat.getModels(BUILTIN_PROVIDER) : [];

// pi's runtime (provider-composer) consumes the pre-0.80 oauth shape:
// old-style login callbacks, refreshToken, and a synchronous getApiKey.
// Adapt the 0.80 OAuthAuth interface (login(interaction)/refresh/toAuth).
function wrapOAuth(oauth: OAuthAuth): AnthropicOAuthProvider {
  return {
    name: oauth.name,
    login: (callbacks) =>
      oauth.login({
        ...(callbacks.signal ? { signal: callbacks.signal } : {}),
        notify: (event) => {
          switch (event.type) {
            case "auth_url":
              callbacks.onAuth({
                url: event.url,
                ...(event.instructions
                  ? { instructions: event.instructions }
                  : {}),
              });
              break;
            case "device_code":
              callbacks.onDeviceCode(event);
              break;
            default:
              callbacks.onProgress?.(event.message);
          }
        },
        prompt: (prompt) => {
          if (prompt.type === "manual_code" && callbacks.onManualCodeInput) {
            return callbacks.onManualCodeInput();
          }
          if (prompt.type === "select") {
            return callbacks
              .onSelect({
                message: prompt.message,
                options: prompt.options.map(({ id, label }) => ({ id, label })),
              })
              .then((choice) => choice ?? "");
          }
          return callbacks.onPrompt({
            message: prompt.message,
            ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
          });
        },
      }),
    refreshToken: (credentials) =>
      oauth.refresh({ ...credentials, type: "oauth" }),
    // toAuth() is async but pi needs a sync string; for Anthropic OAuth the
    // access token is the api key (mirrors pi's own extension docs example).
    getApiKey: (credentials) => credentials.access,
  };
}

// Stock pi-ai 0.80 compat does not re-export the OAuth providers; the
// pi-repatch'd install does. Resolve lazily via the namespace so the module
// still loads (and tests run) against stock pi-ai.
const defaultDeps = (): AnthropicAliasDeps => {
  const { anthropicOAuth } = piAiCompat as Partial<{
    anthropicOAuth: OAuthAuth;
  }>;
  if (!anthropicOAuth) {
    throw new Error(
      "@earendil-works/pi-ai/compat does not export anthropicOAuth; run pi-repatch",
    );
  }
  return {
    getModels: defaultGetModels,
    oauthProvider: wrapOAuth(anthropicOAuth),
    loadAliases: loadClaudeAliases,
  };
};

export default function claudeAliases(pi: ExtensionAPI): void {
  registerClaudeAliases(pi);
}

export function registerClaudeAliases(
  pi: ClaudeAliasExtensionAPI,
  deps: AnthropicAliasDeps = defaultDeps(),
): void {
  let activeAliases: ClaudeAliasDefinition[] = [];
  let registeredProviderIds = new Set<string>();
  let lastRegistrationSignature: string | undefined;
  let lastErrorSignature: string | undefined;

  function refreshAliasProviders(ctx?: RefreshContext): void {
    const loaded = deps.loadAliases({
      ...(ctx?.cwd ? { cwd: ctx.cwd } : {}),
      ...(ctx ? { projectTrusted: ctx.isProjectTrusted() } : {}),
    });
    reportConfigErrors(loaded.errors, ctx, lastErrorSignature);
    lastErrorSignature = loaded.errors.join("\n");

    const aliases = loaded.aliases;
    const sourceModels = resolveBuiltinAnthropicModels(
      deps,
      ctx?.modelRegistry,
    );
    const signature = getRegistrationSignature(aliases, sourceModels);
    const changed = signature !== lastRegistrationSignature;

    if (changed) {
      syncRegisteredProviders(
        pi,
        aliases,
        deps.oauthProvider,
        sourceModels,
        registeredProviderIds,
      );
      registeredProviderIds = new Set(aliases.map((alias) => alias.providerId));
      activeAliases = aliases;
      lastRegistrationSignature = signature;
    }

    syncAliasStatus(ctx, activeAliases);
  }

  refreshAliasProviders();

  const refresh = (_event: unknown, ctx: unknown) => {
    if (!isRefreshContext(ctx)) return;
    refreshAliasProviders(ctx);
  };

  pi.on("session_start", refresh);
  pi.on("model_select", refresh);
  pi.on("before_agent_start", refresh);
  pi.on("session_shutdown", (_event, ctx: unknown) => {
    if (!isRefreshContext(ctx)) return;
    if (ctx.hasUI) {
      ctx.ui.setStatus(FOOTER_STATUS_KEY, undefined);
    }
  });
}

export function resolveBuiltinAnthropicModels(
  deps: AnthropicAliasDeps,
  modelRegistry?: ModelRegistryLike,
): AnthropicModel[] {
  const builtinModels = deps
    .getModels(BUILTIN_PROVIDER)
    .filter(isAnthropicModel);
  if (!modelRegistry) return [...builtinModels];

  return builtinModels.map((model) => {
    const override = modelRegistry.find(BUILTIN_PROVIDER, model.id);
    return isAnthropicModel(override) ? override : model;
  });
}

export function registerAnthropicAlias(
  pi: ClaudeAliasExtensionAPI,
  alias: ClaudeAliasDefinition,
  oauthProvider: AnthropicOAuthProvider,
  sourceModels: readonly AnthropicModel[],
): void {
  pi.registerProvider(alias.providerId, {
    baseUrl: sourceModels[0]?.baseUrl ?? BUILTIN_BASE_URL,
    api: BUILTIN_API,
    models: sourceModels.map((model) => cloneAliasModel(model, alias.label)),
    oauth: {
      ...oauthProvider,
      name: getAliasOAuthName(oauthProvider.name, alias.label),
    },
  });
}

export function getAliasOAuthName(baseName: string, label: string): string {
  return `${baseName} - ${label}`;
}

export function getFooterStatusText(
  model: { provider: string; id: string } | undefined,
  aliases: readonly ClaudeAliasDefinition[],
): string | undefined {
  if (!model) return undefined;

  const alias = aliases.find((item) => item.providerId === model.provider);
  if (!alias) return undefined;

  return `${alias.handle} · ${formatFooterModelLabel(model.id)}`;
}

export function formatFooterModelLabel(modelId: string): string {
  const trimmed = modelId.startsWith("claude-") ? modelId.slice(7) : modelId;
  const short = trimmed.match(/^(opus|sonnet|haiku|fable)-(\d+)-(\d+)$/i);
  if (short) {
    const [, family, major, minor] = short;
    if (family && major && minor) {
      return `${family.toLowerCase()}-${major}.${minor}`;
    }
  }

  const dated = trimmed.match(
    /^(opus|sonnet|haiku|fable)-(\d+)-(\d+)-(\d{8})$/i,
  );
  if (dated) {
    const [, family, major, minor, stamp] = dated;
    if (family && major && minor && stamp) {
      return `${family.toLowerCase()}-${major}.${minor}@${stamp}`;
    }
  }

  return trimmed;
}

function syncRegisteredProviders(
  pi: ClaudeAliasExtensionAPI,
  aliases: readonly ClaudeAliasDefinition[],
  oauthProvider: AnthropicOAuthProvider,
  sourceModels: readonly AnthropicModel[],
  registeredProviderIds: ReadonlySet<string>,
): void {
  const nextProviderIds = new Set(aliases.map((alias) => alias.providerId));

  for (const providerId of registeredProviderIds) {
    if (!nextProviderIds.has(providerId)) {
      pi.unregisterProvider(providerId);
    }
  }

  for (const alias of aliases) {
    registerAnthropicAlias(pi, alias, oauthProvider, sourceModels);
  }
}

function syncAliasStatus(
  ctx: RefreshContext | undefined,
  aliases: readonly ClaudeAliasDefinition[],
): void {
  if (!ctx?.hasUI) return;
  ctx.ui.setStatus(FOOTER_STATUS_KEY, getFooterStatusText(ctx.model, aliases));
}

function reportConfigErrors(
  errors: readonly string[],
  ctx: RefreshContext | undefined,
  lastErrorSignature: string | undefined,
): void {
  const signature = errors.join("\n");
  if (!signature || signature === lastErrorSignature) return;

  const message = `claude-alias config: ${errors[0]}`;
  if (ctx?.hasUI) {
    ctx.ui.notify(message, "error");
    return;
  }

  console.warn(message);
}

function isAnthropicModel(model: unknown): model is AnthropicModel {
  return hasApi(model) && model.api === BUILTIN_API;
}

function isRefreshContext(value: unknown): value is RefreshContext {
  return (
    isRecord(value) &&
    typeof value.cwd === "string" &&
    typeof value.hasUI === "boolean" &&
    typeof value.isProjectTrusted === "function" &&
    isRecord(value.ui) &&
    typeof value.ui.setStatus === "function" &&
    typeof value.ui.notify === "function"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasApi(value: unknown): value is { api: unknown } {
  return typeof value === "object" && value !== null && "api" in value;
}

function getRegistrationSignature(
  aliases: readonly ClaudeAliasDefinition[],
  models: readonly AnthropicModel[],
): string {
  return JSON.stringify({
    aliases: aliases.map((alias) => ({
      providerId: alias.providerId,
      handle: alias.handle,
      label: alias.label,
    })),
    models: models.map((model) => ({
      id: model.id,
      name: model.name,
      api: model.api,
      baseUrl: model.baseUrl,
      reasoning: model.reasoning,
      input: [...model.input],
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      thinkingLevelMap: model.thinkingLevelMap,
      headers: model.headers,
      compat: model.compat,
    })),
  });
}

function cloneAliasModel(model: AnthropicModel, label: string): AnthropicModel {
  const cloned = structuredClone(model);
  cloned.name = `${model.name} (${label})`;
  return cloned;
}
