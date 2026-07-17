import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  getGlobalAliasConfigPath,
  getProjectAliasConfigPath,
  loadAliases,
  parseAliasConfig,
} from "../src/config.js";

const PROVIDER_CASES = [
  { provider: "anthropic", handlePrefix: "claude", builtin: "anthropic" },
  { provider: "openai-codex", handlePrefix: "codex", builtin: "openai-codex" },
] as const;

for (const { provider, handlePrefix, builtin } of PROVIDER_CASES) {
  test(`parseAliasConfig applies ${provider} defaults for handle and provider id`, () => {
    const parsed = parseAliasConfig(
      JSON.stringify({ aliases: [{ provider, slug: "labs" }] }),
      "test.json",
    );

    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(parsed.aliases, [
      {
        provider,
        slug: "labs",
        providerId: `${builtin}-labs`,
        handle: `${handlePrefix}-labs`,
        label: "Labs",
      },
    ]);
  });
}

test("parseAliasConfig defaults the provider to anthropic", () => {
  const parsed = parseAliasConfig(
    JSON.stringify({
      aliases: [{ slug: "Work Account", handle: "Claude Work", label: "Work" }],
    }),
    "test.json",
  );

  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.aliases, [
    {
      provider: "anthropic",
      slug: "work-account",
      providerId: "anthropic-work-account",
      handle: "claude-work",
      label: "Work",
    },
  ]);
});

test("parseAliasConfig rejects unknown providers", () => {
  const parsed = parseAliasConfig(
    JSON.stringify({
      aliases: [{ provider: "openai", slug: "work" }, { slug: "labs" }],
    }),
    "test.json",
  );

  assert.match(
    parsed.errors.join("\n"),
    /aliases\[0\]: unknown provider "openai"/,
  );
  assert.deepEqual(
    parsed.aliases.map((alias) => alias.providerId),
    ["anthropic-labs"],
  );
});

test("loadAliases allows the same slug across providers", (t) => {
  const root = makeTempDir(t);
  const agentDir = join(root, "agent");

  writeJson(getGlobalAliasConfigPath(agentDir), {
    aliases: [
      { slug: "work", label: "Work" },
      { provider: "openai-codex", slug: "work", label: "Codex Work" },
    ],
  });

  const loaded = loadAliases({ agentDir });

  assert.deepEqual(loaded.errors, []);
  assert.deepEqual(loaded.aliases, [
    {
      provider: "anthropic",
      slug: "work",
      providerId: "anthropic-work",
      handle: "claude-work",
      label: "Work",
    },
    {
      provider: "openai-codex",
      slug: "work",
      providerId: "openai-codex-work",
      handle: "codex-work",
      label: "Codex Work",
    },
  ]);
});

test("loadAliases merges trusted project aliases per (provider, slug)", (t) => {
  const root = makeTempDir(t);
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");

  writeJson(getGlobalAliasConfigPath(agentDir), {
    aliases: [
      { slug: "work", handle: "claude-work", label: "Work" },
      { provider: "openai-codex", slug: "work", label: "Codex Work" },
    ],
  });
  writeJson(getProjectAliasConfigPath(cwd), {
    aliases: [{ slug: "work", handle: "claude-client", label: "Client" }],
  });

  const loaded = loadAliases({ cwd, projectTrusted: true, agentDir });

  assert.deepEqual(loaded.errors, []);
  assert.deepEqual(loaded.aliases, [
    {
      provider: "anthropic",
      slug: "work",
      providerId: "anthropic-work",
      handle: "claude-client",
      label: "Client",
    },
    {
      provider: "openai-codex",
      slug: "work",
      providerId: "openai-codex-work",
      handle: "codex-work",
      label: "Codex Work",
    },
  ]);
});

test("loadAliases ignores project config when the project is untrusted", (t) => {
  const root = makeTempDir(t);
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");

  writeJson(getGlobalAliasConfigPath(agentDir), {
    aliases: [{ slug: "work", handle: "claude-work", label: "Work" }],
  });
  writeJson(getProjectAliasConfigPath(cwd), {
    aliases: [{ slug: "work", handle: "claude-client", label: "Client" }],
  });

  const loaded = loadAliases({ cwd, projectTrusted: false, agentDir });

  assert.deepEqual(loaded.errors, []);
  assert.deepEqual(loaded.aliases, [
    {
      provider: "anthropic",
      slug: "work",
      providerId: "anthropic-work",
      handle: "claude-work",
      label: "Work",
    },
  ]);
});

test("loadAliases rejects duplicate handles across providers", (t) => {
  const root = makeTempDir(t);
  const agentDir = join(root, "agent");

  writeJson(getGlobalAliasConfigPath(agentDir), {
    aliases: [
      { slug: "work", handle: "shared", label: "Work" },
      { provider: "openai-codex", slug: "labs", handle: "shared" },
    ],
  });

  const loaded = loadAliases({ agentDir });

  assert.match(loaded.errors.join("\n"), /Duplicate alias handle: shared/);
  assert.deepEqual(loaded.aliases, [
    {
      provider: "anthropic",
      slug: "work",
      providerId: "anthropic-work",
      handle: "shared",
      label: "Work",
    },
  ]);
});

test("loadAliases keeps valid project aliases when global config is broken", (t) => {
  const root = makeTempDir(t);
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");

  mkdirSync(dirname(getGlobalAliasConfigPath(agentDir)), {
    recursive: true,
  });
  writeFileSync(getGlobalAliasConfigPath(agentDir), "{", "utf8");
  writeJson(getProjectAliasConfigPath(cwd), {
    aliases: [{ slug: "work", handle: "claude-work", label: "Work" }],
  });

  const loaded = loadAliases({ cwd, projectTrusted: true, agentDir });

  assert.match(loaded.errors.join("\n"), /Invalid JSON/);
  assert.deepEqual(loaded.aliases, [
    {
      provider: "anthropic",
      slug: "work",
      providerId: "anthropic-work",
      handle: "claude-work",
      label: "Work",
    },
  ]);
});

test("parseAliasConfig reports malformed input", () => {
  const malformed = parseAliasConfig("{", "broken.json");
  assert.match(malformed.errors.join("\n"), /Invalid JSON/);

  const arrayRoot = parseAliasConfig("[]", "broken.json");
  assert.match(arrayRoot.errors.join("\n"), /expected an object/);

  const badShape = parseAliasConfig(
    JSON.stringify({ aliases: {} }),
    "broken.json",
  );
  assert.match(badShape.errors.join("\n"), /expected aliases to be an array/);

  const badEntry = parseAliasConfig(
    JSON.stringify({ aliases: [{ handle: "claude-work" }] }),
    "broken.json",
  );
  assert.match(badEntry.errors.join("\n"), /missing or invalid slug/);

  const emptySlug = parseAliasConfig(
    JSON.stringify({ aliases: [{ slug: "---" }] }),
    "broken.json",
  );
  assert.match(emptySlug.errors.join("\n"), /missing or invalid slug/);
});

test("parseAliasConfig falls back to the default handle for a non-string handle", () => {
  const parsed = parseAliasConfig(
    JSON.stringify({ aliases: [{ slug: "work", handle: 123 }] }),
    "test.json",
  );

  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.aliases[0]?.handle, "claude-work");
});

test("loadAliases lets a later duplicate (provider, slug) entry win", (t) => {
  const root = makeTempDir(t);
  const agentDir = join(root, "agent");

  writeJson(getGlobalAliasConfigPath(agentDir), {
    aliases: [
      { slug: "work", label: "First" },
      { slug: "work", label: "Second", handle: "claude-second" },
    ],
  });

  const loaded = loadAliases({ agentDir });

  assert.deepEqual(loaded.errors, []);
  assert.deepEqual(loaded.aliases, [
    {
      provider: "anthropic",
      slug: "work",
      providerId: "anthropic-work",
      handle: "claude-second",
      label: "Second",
    },
  ]);
});

test("loadAliases reports unreadable config files as config errors", (t) => {
  const root = makeTempDir(t);
  const agentDir = join(root, "agent");
  // The config path is a directory: readFileSync throws EISDIR.
  mkdirSync(getGlobalAliasConfigPath(agentDir), { recursive: true });

  const loaded = loadAliases({ agentDir });

  assert.deepEqual(loaded.aliases, []);
  assert.match(
    loaded.errors.join("\n"),
    /Cannot read alias config at .*EISDIR/,
  );
});

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeTempDir(t: { after(callback: () => void): void }): string {
  const path = mkdtempSync(join(tmpdir(), "pi-sub-aliases-"));
  t.after(() => {
    rmSync(path, { recursive: true, force: true });
  });
  return path;
}
