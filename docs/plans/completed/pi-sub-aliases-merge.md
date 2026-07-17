# Plan: merge codex-aliases into pi-claude-alias → pi-sub-aliases

One extension for subscription-account aliases (Anthropic + OpenAI Codex), based on the
current pi-claude-alias code. Replaces `pi-claude-alias` and `@carlosgtrz/pi-codex-aliases`.

## Decisions (fixed)

- Name: `pi-sub-aliases` (npm package + GitHub repo `alexei-led/pi-sub-aliases`),
  version 0.2.0 — the next minor. npm does not support package renames or redirects;
  the supported mechanism is publishing under the new name and `npm deprecate`-ing the
  old one with a pointer message. GitHub repo rename does redirect old URLs.
- Config: `sub-aliases.json` only (global agent dir + trusted project merge, as today). No
  legacy `claude-alias.json` fallback.
- Provider ids stay `<builtin>-<slug>` (`anthropic-personal`, `openai-codex-work`, …).
  This keeps `model-router.json` patterns and stored OAuth credentials valid — no re-login,
  no router changes.
- Model metadata (contextWindow/maxTokens) always cloned from pi's live registry via
  `getModels(builtin)` at startup — never hardcoded, no config overrides. Resolves
  CarlosGtrz/carlosgtrz-pi-extensions#1 by construction.
- Keep from codex-aliases: the Codex stream wrapper, sub-bar env sync. Drop: hardcoded
  aliases, OAuth path-scavenging, legacy-shape adapters (our `wrapOAuth` covers both
  providers via the pi-repatch'd `compat` exports).
- MIT attribution line in README for code derived from CarlosGtrz/carlosgtrz-pi-extensions.

## Target design

```
src/
  config.ts        schema v2: { aliases: [{ provider?, slug, handle?, label? }] }
                   provider ∈ {"anthropic","openai-codex"}, default "anthropic";
                   default handle `<handlePrefix>-<slug>`; dedup key (provider, slug);
                   handles unique globally; providerId = `<builtin>-<slug>`
  providers.ts     ProviderSpec table:
                   { builtin, oauthExport, handlePrefix, footerLabel,
                     wrapStream?, syncEnv? }
                   anthropic: { builtin: "anthropic", oauthExport: "anthropicOAuth",
                                handlePrefix: "claude", footerLabel: claudeShortLabel }
                   openai-codex: { builtin: "openai-codex", oauthExport: "openaiCodexOAuth",
                                   handlePrefix: "codex", footerLabel: identity,
                                   wrapStream: wrapCodexStream, syncEnv: syncCodexEnv }
  oauth.ts         wrapOAuth (moved from index.ts, parameterized by export name);
                   lazy compat lookup, per-provider "run pi-repatch" error
  codex-stream.ts  ported from upstream: register `${providerId}-responses` api that
                   wraps streamSimple, rewriting provider → "openai-codex" inbound and
                   back to the alias outbound (pi's Codex stream checks provider name).
                   Imports split by what stock pi-ai actually exports: streamSimple
                   from "@earendil-works/pi-ai/compat", createAssistantMessageEventStream
                   from "@earendil-works/pi-ai" root; streamSimple injected via the
                   deps object (same pattern as AnthropicAliasDeps) so tests can mock it
  codex-env.ts     sub-bar sync: on alias model select, set OPENAI_CODEX_*/
                   CHATGPT_ACCOUNT_ID for the selected alias credential and trigger
                   `sub-core:action` refresh. Credential comes from
                   ctx.modelRegistry.authStorage.get(providerId) — an undocumented
                   internal absent from stock types; declare a local structural
                   interface (like ModelRegistryLike, index.ts:33) so it typechecks
                   against stock packages
  index.ts         load config → for each alias: clone models from
                   getModels(spec.builtin), registerProvider, wrap oauth, apply
                   wrapStream/syncEnv when present; footer status shows
                   `<handle> · <footerLabel(modelId)>` on session_start/model_select/
                   before_agent_start (mechanics unchanged)
```

Footer labels: anthropic keeps the existing claude regex shortener; codex models
(`gpt-5.5` etc.) are short already — identity fallback. Footer status key renames
`claude-alias` → `sub-aliases` (verified: no local pi config references the old key;
README documents the new one as the pi-powerline-footer integration contract).

## Constraints for executors

- Hermetic: lint/typecheck/tests MUST pass against STOCK `@earendil-works/pi-ai`
  (`npm ci` tree). OAuth providers resolve lazily at runtime only; never import
  `anthropicOAuth`/`openaiCodexOAuth` statically.
- `verify` = `npm run verify` (lint + typecheck + tests). Every task ends green.
- Reference source for the port:
  `~/.pi/agent/npm/node_modules/@carlosgtrz/pi-codex-aliases/src/index.ts` (read-only).
- Do NOT touch anything outside this repo: no `~/.pi`, no `~/.local`, no chezmoi, no
  `gh repo rename`, no git tags, no npm publish. Those are post-exec steps below.

### Task 1: Multi-provider core refactor

- [x] `src/config.ts`: schema v2 per Target design — optional `provider` field
      (`"anthropic"` default, `"openai-codex"` allowed, unknown → validation error),
      config file constant renamed to `sub-aliases.json`, dedup key `(provider, slug)`
      (same slug allowed across providers), handles unique globally, default handle
      `<handlePrefix>-<slug>` per provider, `providerId = <builtin>-<slug>`
- [x] Extract `src/oauth.ts` from `index.ts`: `wrapOAuth` parameterized by the compat
      export name (`piAiCompat[spec.oauthExport]`), lazy resolution kept, per-provider
      "run pi-repatch" error message
- [x] Add `src/providers.ts`: ProviderSpec table with anthropic + openai-codex entries
      (codex `wrapStream`/`syncEnv` hooks stubbed as no-ops for now)
- [x] Rewire `src/index.ts` to iterate specs/aliases generically; footer status key
      renamed `claude-alias` → `sub-aliases`; notify prefix updated accordingly
- [x] Update `test/config.test.ts`: parameterize by provider (defaults, handle
      prefixes, `(provider, slug)` dedup, cross-provider same slug allowed, unknown
      provider error)
- [x] Rename `test/claude-alias.test.ts` → `test/sub-aliases.test.ts`; update wiring
      and status-key assertions (`claude-alias` → `sub-aliases`)
- [x] Gate: `npm run verify` green against stock pi-ai

### Task 2: Codex support

- [x] Port `src/codex-stream.ts` from the reference source (stream wrapper only; none
      of the path-scavenging or legacy-shape adapters). Split imports per Target
      design: `streamSimple` from `@earendil-works/pi-ai/compat`,
      `createAssistantMessageEventStream` from `@earendil-works/pi-ai` root;
      `streamSimple` injected via the deps object so tests can mock it. Source
      attribution comment (MIT, CarlosGtrz/carlosgtrz-pi-extensions)
- [x] Add `src/codex-env.ts`: env sync (`OPENAI_CODEX_*`/`CHATGPT_ACCOUNT_ID`) +
      `sub-core:action` refresh on alias model select; local structural interface for
      `modelRegistry.authStorage` per Target design
- [x] Wire both into the openai-codex ProviderSpec (`wrapStream`/`syncEnv`)
- [x] Footer: generic fallback label for non-anthropic models
- [x] Tests: stream wrapper rewrites provider inbound/outbound (mock streamSimple);
      env sync sets vars + fires refresh on model_select (mock pi events/env); footer
      labels for both providers; cloned models mirror mocked registry metadata
      (issue #1 regression)
- [x] Gate: `npm run verify` green; `npm pack` smoke test passes

### Task 3: Rename package + docs

- [x] `package.json`: name `pi-sub-aliases`, version 0.2.0, repository/homepage/bugs
      URLs → `alexei-led/pi-sub-aliases`, `description` covers both providers,
      `keywords` add openai/codex/chatgpt
- [x] Sweep `grep -riE "pi-claude-alias|claude-alias" --exclude-dir=node_modules .`
      — fix remaining refs (package-smoke test, scripts/, badges, assets/posts refs)
- [x] README rewrite: both providers, `sub-aliases.json` schema + example, footer
      status key `sub-aliases`, pi-repatch requirement, MIT attribution for the Codex
      stream wrapper, migration section (from pi-claude-alias and
      @carlosgtrz/pi-codex-aliases)
- [x] CHANGELOG 0.2.0 entry (breaking: package + config file rename; migration note)
- [x] Gate: `npm run verify` green; `npm pack` shows name `pi-sub-aliases@0.2.0`

## Post-exec steps (main session only — NOT for exec subagents)

These touch the live machine, GitHub, and npm; they run after the exec branch merges
to main.

### P1. Local validation (pre-release)

pi supports local path installs (`pi install /absolute/path` — added to settings
without copying, loads straight from the workspace).

1. Write `~/.pi/agent/sub-aliases.json`:

   ```json
   {
     "aliases": [
       { "slug": "personal", "label": "Personal", "handle": "claude-personal" },
       { "slug": "work", "label": "Work", "handle": "claude-work" },
       {
         "provider": "openai-codex",
         "slug": "personal",
         "label": "Codex Personal",
         "handle": "codex-personal"
       },
       {
         "provider": "openai-codex",
         "slug": "work",
         "label": "Codex Work",
         "handle": "codex-work"
       }
     ]
   }
   ```

2. Temporarily remove `npm:pi-claude-alias` and `npm:@carlosgtrz/pi-codex-aliases`
   from `~/.pi/agent/settings.json` packages (avoids duplicate provider registration),
   then `pi install ~/Workspace/pi-claude-alias`.
3. herdr: create a tab next to this one (`herdr tab create --label "sub-aliases"`),
   run `pi` in it, validate the checklist:
   - pi starts with no extension errors
   - `anthropic-personal/*` model streams a reply (OAuth `(sub)` billing)
   - `openai-codex-work/*` model streams a reply (stream wrapper works)
   - footer shows `<handle> · <model>` for both providers; status key `sub-aliases`
   - sub-bar tracks the selected codex account
   - no "No models match pattern" router warnings from `model-router.json`
4. Remove the local path entry from settings again (the final switch to the npm
   package happens in P3; the two old npm packages stay removed).

Gate: full checklist passes against the workspace build.

### P2. Repo rename + release 0.2.0

1. `gh repo rename pi-sub-aliases` (old URLs redirect), then
   `git remote set-url origin git@github.com:alexei-led/pi-sub-aliases.git`.
2. Push to main, CI green.
3. Tag `v0.2.0`, push tag → Release workflow publishes to npm with provenance
   (local npm token is expired; CI is the only publish path).
4. Verify `npm view pi-sub-aliases version` → 0.2.0.

Gate: npm shows 0.2.0; CI Release run green.

### P3. Local migration (deployed pi)

1. `~/.pi/agent/sub-aliases.json` was already written in P1 — keep it. Remove
   `~/.pi/agent/claude-alias.json`.
2. `~/.pi/agent/settings.json` packages: add `npm:pi-sub-aliases` (the two old alias
   packages were removed in P1).
3. Let pi sync extension deps (start pi once; it syncs `~/.pi/agent/npm`); verify
   `~/.pi/agent/npm/package.json` gained `pi-sub-aliases` and lost the two old ones.
4. herdr: re-run the P1 checklist in the validation tab, now against the npm install.

Gate: checklist passes; deps verified.

### P4. chezmoi update

1. `chezmoi source-path` for `~/.pi/agent/claude-alias.json` → remove source;
   `chezmoi add ~/.pi/agent/sub-aliases.json`.
2. `chezmoi re-add ~/.pi/agent/settings.json` (packages change).
3. `~/.local/bin/pi-repatch` header comment mentions the extension names — update to
   `pi-sub-aliases`; `chezmoi re-add` it. No functional change (it already exports both
   OAuth providers).
4. `chezmoi apply` clean; `chezmoi diff` empty.

Gate: `chezmoi diff` empty; `chezmoi managed` lists sub-aliases.json, not claude-alias.json.

### P5. Wrap-up

1. `npm deprecate pi-claude-alias "Renamed to pi-sub-aliases"` — needs a fresh npm token
   (current one expired); do via npmjs.com web UI or after token refresh. Manual step.
2. Comment on CarlosGtrz/carlosgtrz-pi-extensions#1: addressed in pi-sub-aliases
   (metadata cloned live from pi registry).
3. Update memory note (pi-oauth-patching-layout) — extension names changed.
4. Terminal action, strictly after everything above: rename the workspace dir
   `~/Workspace/pi-claude-alias` → `~/Workspace/pi-sub-aliases`. All earlier steps
   run from the old path; a premature rename fails nothing loudly, it just leaves
   later commands in a stale cwd — nothing may follow this step.

## Risks

- Codex stream wrapper depends on pi internals (provider-name checks in the Codex
  stream). Mitigation: it's the exact code running in production today; covered by a
  test with a mocked stream; herdr live checks in P1 and P3.
- pi package sync may pin/miss the new package: verify `~/.pi/agent/npm/package.json`
  gained `pi-sub-aliases` and lost the two old ones.
- sub-bar env sync relies on `sub-core:action` event name — verified present in
  installed `@marckrenn/pi-sub-bar` (index.ts:791).
- Workspace dir rename silently invalidates the shell cwd for later steps — it is the
  plan's terminal action (P5.4); nothing may follow it.
- codex-env depends on the undocumented `modelRegistry.authStorage` internal (shape
  `{type, access, accountId}`) — review finding: this internal does not exist on
  pi 0.80.10 (upstream degrades silently). codex-env keeps the structural-typed
  in-memory probe but falls back to pi's public `readStoredCredential` (auth.json),
  which works on stock 0.80.10. Revalidate live in P1 and P3.
