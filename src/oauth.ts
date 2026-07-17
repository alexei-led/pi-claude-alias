import * as piAiCompat from "@earendil-works/pi-ai/compat";
import type {
  OAuthAuth,
  OAuthCredentials,
  OAuthLoginCallbacks,
} from "@earendil-works/pi-ai/compat";

export type OAuthExportName = "anthropicOAuth" | "openaiCodexOAuth";

export type WrappedOAuthProvider = {
  name: string;
  login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
  refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
  getApiKey(credentials: OAuthCredentials): string;
};

// Stock pi-ai 0.80 compat does not re-export the OAuth providers; the
// pi-repatch'd install does. Resolve lazily via the namespace so the module
// still loads (and tests run) against stock pi-ai.
export function wrapOAuth(oauthExport: OAuthExportName): WrappedOAuthProvider {
  const oauth = (piAiCompat as Partial<Record<OAuthExportName, OAuthAuth>>)[
    oauthExport
  ];
  if (!oauth) {
    throw new Error(
      `@earendil-works/pi-ai/compat does not export ${oauthExport}; run pi-repatch`,
    );
  }
  return adaptOAuth(oauth);
}

// pi's runtime (provider-composer) consumes the pre-0.80 oauth shape:
// old-style login callbacks, refreshToken, and a synchronous getApiKey.
// Adapt the 0.80 OAuthAuth interface (login(interaction)/refresh/toAuth).
// Exported for tests: on stock pi-ai the compat exports are absent, so the
// adapter is otherwise unreachable in CI.
export function adaptOAuth(oauth: OAuthAuth): WrappedOAuthProvider {
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
    // toAuth() is async but pi needs a sync string; for both providers the
    // OAuth access token is the api key (mirrors pi's own extension docs).
    getApiKey: (credentials) => credentials.access,
  };
}
