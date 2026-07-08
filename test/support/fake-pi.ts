import type { ClaudeAliasExtensionAPI } from "../../src/index.js";

type CapturedProviderConfig = Parameters<
  ClaudeAliasExtensionAPI["registerProvider"]
>[1];
type Handler = (event: unknown, ctx: unknown) => unknown;

export interface FakeModelRegistry {
  find(provider: string, modelId: string): ModelLike | undefined;
}

interface ModelLike {
  api?: string;
  id?: string;
}

export interface FakeContext {
  cwd: string;
  hasUI: boolean;
  model?: { provider: string; id: string };
  modelRegistry?: FakeModelRegistry;
  isProjectTrusted(): boolean;
  ui: FakeUi;
}

export class FakePi implements ClaudeAliasExtensionAPI {
  readonly providers = new Map<string, CapturedProviderConfig>();
  readonly unregisteredProviderIds: string[] = [];
  readonly handlers = new Map<string, Handler[]>();

  registerProvider(providerId: string, config: CapturedProviderConfig): void {
    this.providers.set(providerId, config);
  }

  unregisterProvider(providerId: string): void {
    this.providers.delete(providerId);
    this.unregisteredProviderIds.push(providerId);
  }

  on(event: string, handler: Handler): void {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
  }

  emit(event: string, ctx: FakeContext): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler({}, ctx);
    }
  }

  createContext(overrides: Partial<FakeContext> = {}): FakeContext {
    return {
      cwd: "/project",
      hasUI: true,
      isProjectTrusted: () => true,
      ui: new FakeUi(),
      ...overrides,
    };
  }
}

export class FakeUi {
  readonly statuses: Array<{ key: string; text: string | undefined }> = [];
  readonly notifications: Array<{
    message: string;
    type: "info" | "warning" | "error" | undefined;
  }> = [];

  setStatus(key: string, text: string | undefined): void {
    this.statuses.push({ key, text });
  }

  notify(message: string, type?: "info" | "warning" | "error"): void {
    this.notifications.push({ message, type });
  }

  lastStatus(key: string): string | undefined {
    return this.statuses.findLast((entry) => entry.key === key)?.text;
  }
}
