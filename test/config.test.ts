import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  getGlobalClaudeAliasConfigPath,
  getProjectClaudeAliasConfigPath,
  loadClaudeAliases,
  parseClaudeAliasConfig,
} from "../src/config.js";

test("parseClaudeAliasConfig normalizes slugs, handles, and labels", () => {
  const parsed = parseClaudeAliasConfig(
    JSON.stringify({
      aliases: [
        { slug: "Work Account", handle: "Claude Work", label: "Work" },
        { slug: "labs" },
      ],
    }),
    "test.json",
  );

  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.aliases, [
    {
      slug: "work-account",
      providerId: "anthropic-work-account",
      handle: "claude-work",
      label: "Work",
    },
    {
      slug: "labs",
      providerId: "anthropic-labs",
      handle: "claude-labs",
      label: "Labs",
    },
  ]);
});

test("loadClaudeAliases merges trusted project aliases over global aliases", (t) => {
  const root = makeTempDir(t);
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");

  writeJson(getGlobalClaudeAliasConfigPath(agentDir), {
    aliases: [
      { slug: "work", handle: "claude-work", label: "Work" },
      { slug: "labs", handle: "claude-labs", label: "Labs" },
    ],
  });
  writeJson(getProjectClaudeAliasConfigPath(cwd), {
    aliases: [{ slug: "work", handle: "claude-client", label: "Client" }],
  });

  const loaded = loadClaudeAliases({ cwd, projectTrusted: true, agentDir });

  assert.deepEqual(loaded.errors, []);
  assert.deepEqual(loaded.aliases, [
    {
      slug: "work",
      providerId: "anthropic-work",
      handle: "claude-client",
      label: "Client",
    },
    {
      slug: "labs",
      providerId: "anthropic-labs",
      handle: "claude-labs",
      label: "Labs",
    },
  ]);
});

test("loadClaudeAliases ignores project config when the project is untrusted", (t) => {
  const root = makeTempDir(t);
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");

  writeJson(getGlobalClaudeAliasConfigPath(agentDir), {
    aliases: [{ slug: "work", handle: "claude-work", label: "Work" }],
  });
  writeJson(getProjectClaudeAliasConfigPath(cwd), {
    aliases: [{ slug: "work", handle: "claude-client", label: "Client" }],
  });

  const loaded = loadClaudeAliases({ cwd, projectTrusted: false, agentDir });

  assert.deepEqual(loaded.errors, []);
  assert.deepEqual(loaded.aliases, [
    {
      slug: "work",
      providerId: "anthropic-work",
      handle: "claude-work",
      label: "Work",
    },
  ]);
});

test("loadClaudeAliases reports invalid files and duplicate handles", (t) => {
  const root = makeTempDir(t);
  const agentDir = join(root, "agent");

  writeJson(getGlobalClaudeAliasConfigPath(agentDir), {
    aliases: [
      { slug: "work", handle: "claude-shared", label: "Work" },
      { slug: "labs", handle: "claude-shared", label: "Labs" },
    ],
  });

  const loaded = loadClaudeAliases({ agentDir });

  assert.match(
    loaded.errors.join("\n"),
    /Duplicate alias handle: claude-shared/,
  );
  assert.deepEqual(loaded.aliases, [
    {
      slug: "work",
      providerId: "anthropic-work",
      handle: "claude-shared",
      label: "Work",
    },
  ]);
});

test("loadClaudeAliases keeps valid project aliases when global config is broken", (t) => {
  const root = makeTempDir(t);
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");

  mkdirSync(dirname(getGlobalClaudeAliasConfigPath(agentDir)), {
    recursive: true,
  });
  writeFileSync(getGlobalClaudeAliasConfigPath(agentDir), "{", "utf8");
  writeJson(getProjectClaudeAliasConfigPath(cwd), {
    aliases: [{ slug: "work", handle: "claude-work", label: "Work" }],
  });

  const loaded = loadClaudeAliases({ cwd, projectTrusted: true, agentDir });

  assert.match(loaded.errors.join("\n"), /Invalid JSON/);
  assert.deepEqual(loaded.aliases, [
    {
      slug: "work",
      providerId: "anthropic-work",
      handle: "claude-work",
      label: "Work",
    },
  ]);
});

test("parseClaudeAliasConfig reports malformed input", () => {
  const malformed = parseClaudeAliasConfig("{", "broken.json");
  assert.match(malformed.errors.join("\n"), /Invalid JSON/);

  const badShape = parseClaudeAliasConfig(
    JSON.stringify({ aliases: {} }),
    "broken.json",
  );
  assert.match(badShape.errors.join("\n"), /expected aliases to be an array/);
});

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeTempDir(t: { after(callback: () => void): void }): string {
  const path = mkdtempSync(join(tmpdir(), "pi-claude-alias-"));
  t.after(() => {
    rmSync(path, { recursive: true, force: true });
  });
  return path;
}
