import assert from "node:assert/strict";
import test from "node:test";
import type {
  OAuthAuth,
  OAuthCredentials,
  OAuthLoginCallbacks,
} from "@earendil-works/pi-ai/compat";
import { adaptOAuth, wrapOAuth } from "../src/oauth.js";

type OAuthCredential = Awaited<ReturnType<OAuthAuth["login"]>>;

const CREDENTIAL: OAuthCredential = {
  type: "oauth",
  refresh: "refresh-token",
  access: "access-token",
  expires: 4_102_444_800_000,
};

test("wrapOAuth reports missing compat exports with a pi-repatch hint", () => {
  // Hermetic: stock pi-ai does not re-export the OAuth providers.
  assert.throws(
    () => wrapOAuth("anthropicOAuth"),
    /anthropicOAuth; run pi-repatch/,
  );
  assert.throws(
    () => wrapOAuth("openaiCodexOAuth"),
    /openaiCodexOAuth; run pi-repatch/,
  );
});

test("adaptOAuth keeps the provider display name and derives the api key", () => {
  const adapted = adaptOAuth(makeFakeOAuth());
  assert.equal(adapted.name, "ChatGPT (Codex)");
  assert.equal(adapted.getApiKey(makeLegacyCredentials("token-1")), "token-1");
});

test("login routes notify events to the legacy callbacks", async () => {
  const { calls, callbacks } = makeCallbacks();
  const adapted = adaptOAuth(
    makeFakeOAuth((interaction) => {
      interaction.notify({
        type: "auth_url",
        url: "https://login",
        instructions: "open it",
      });
      interaction.notify({ type: "auth_url", url: "https://bare" });
      interaction.notify({
        type: "device_code",
        userCode: "AB-12",
        verificationUri: "https://verify",
      });
      interaction.notify({ type: "progress", message: "working" });
      interaction.notify({ type: "info", message: "fyi" });
      return Promise.resolve(CREDENTIAL);
    }),
  );

  const credentials = await adapted.login(callbacks);

  assert.equal(credentials.access, CREDENTIAL.access);
  assert.deepEqual(calls.auth, [
    { url: "https://login", instructions: "open it" },
    { url: "https://bare" },
  ]);
  assert.deepEqual(calls.deviceCode, [
    {
      type: "device_code",
      userCode: "AB-12",
      verificationUri: "https://verify",
    },
  ]);
  assert.deepEqual(calls.progress, ["working", "fyi"]);
});

test("login routes prompts to manual code, select, and generic callbacks", async () => {
  const { calls, callbacks } = makeCallbacks();
  const answers: string[] = [];
  const adapted = adaptOAuth(
    makeFakeOAuth(async (interaction) => {
      answers.push(
        await interaction.prompt({ type: "manual_code", message: "paste" }),
      );
      answers.push(
        await interaction.prompt({
          type: "select",
          message: "pick account",
          options: [{ id: "acct-1", label: "One" }],
        }),
      );
      answers.push(
        await interaction.prompt({
          type: "text",
          message: "enter",
          placeholder: "hint",
        }),
      );
      return CREDENTIAL;
    }),
  );

  await adapted.login(callbacks);

  assert.deepEqual(answers, ["manual-code", "acct-1", "typed"]);
  assert.deepEqual(calls.selects, [
    { message: "pick account", options: [{ id: "acct-1", label: "One" }] },
  ]);
  assert.deepEqual(calls.prompts, [{ message: "enter", placeholder: "hint" }]);
});

test("login falls back to the generic prompt without a manual-code callback", async () => {
  const { calls, callbacks } = makeCallbacks();
  delete callbacks.onManualCodeInput;
  const adapted = adaptOAuth(
    makeFakeOAuth(async (interaction) => {
      await interaction.prompt({ type: "manual_code", message: "paste" });
      return CREDENTIAL;
    }),
  );

  await adapted.login(callbacks);

  assert.deepEqual(calls.prompts, [{ message: "paste" }]);
});

test("login resolves a cancelled select to an empty id", async () => {
  const { callbacks } = makeCallbacks({ selectResult: undefined });
  let answer: string | undefined;
  const adapted = adaptOAuth(
    makeFakeOAuth(async (interaction) => {
      answer = await interaction.prompt({
        type: "select",
        message: "pick",
        options: [],
      });
      return CREDENTIAL;
    }),
  );

  await adapted.login(callbacks);

  assert.equal(answer, "");
});

test("login forwards the abort signal when present", async () => {
  const controller = new AbortController();
  let seenSignal: AbortSignal | undefined;
  const adapted = adaptOAuth(
    makeFakeOAuth((interaction) => {
      seenSignal = interaction.signal;
      return Promise.resolve(CREDENTIAL);
    }),
  );

  const { callbacks } = makeCallbacks();
  callbacks.signal = controller.signal;
  await adapted.login(callbacks);
  assert.equal(seenSignal, controller.signal);

  delete callbacks.signal;
  seenSignal = undefined;
  await adapted.login(callbacks);
  assert.equal(seenSignal, undefined);
});

test("refreshToken re-tags the stored credential as oauth", async () => {
  const received: OAuthCredential[] = [];
  const adapted = adaptOAuth(
    makeFakeOAuth(undefined, (credential) => {
      received.push(credential);
      return Promise.resolve({ ...credential, access: "new-access" });
    }),
  );

  const refreshed = await adapted.refreshToken(
    makeLegacyCredentials("old-access"),
  );

  const [stored] = received;
  assert.ok(stored);
  assert.equal(stored.type, "oauth");
  assert.equal(stored.access, "old-access");
  assert.equal(refreshed.access, "new-access");
});

function makeFakeOAuth(
  login?: OAuthAuth["login"],
  refresh?: OAuthAuth["refresh"],
): OAuthAuth {
  return {
    name: "ChatGPT (Codex)",
    login: login ?? (() => Promise.resolve(CREDENTIAL)),
    refresh: refresh ?? ((credential) => Promise.resolve(credential)),
    toAuth: () => Promise.reject(new Error("not used")),
  };
}

function makeLegacyCredentials(access: string): OAuthCredentials {
  return { refresh: "refresh-token", access, expires: 4_102_444_800_000 };
}

function makeCallbacks(options: { selectResult?: string | undefined } = {}) {
  const calls = {
    auth: [] as unknown[],
    deviceCode: [] as unknown[],
    progress: [] as string[],
    prompts: [] as unknown[],
    selects: [] as unknown[],
  };
  const selectResult =
    "selectResult" in options ? options.selectResult : "acct-1";
  const callbacks: OAuthLoginCallbacks = {
    onAuth: (info) => {
      calls.auth.push(info);
    },
    onDeviceCode: (info) => {
      calls.deviceCode.push(info);
    },
    onProgress: (message) => {
      calls.progress.push(message);
    },
    onPrompt: (prompt) => {
      calls.prompts.push(prompt);
      return Promise.resolve("typed");
    },
    onManualCodeInput: () => Promise.resolve("manual-code"),
    onSelect: (prompt) => {
      calls.selects.push(prompt);
      return Promise.resolve(selectResult);
    },
  };
  return { calls, callbacks };
}
