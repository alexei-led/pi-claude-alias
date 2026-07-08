import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface PackFile {
  path: string;
}

interface PackResult {
  filename: string;
  name: string;
  version: string;
  size: number;
  files: PackFile[];
}

test("npm pack only includes runtime package assets", async (t) => {
  const packDir = await mkdtemp(join(tmpdir(), "pi-claude-alias-pack-"));
  t.after(async () => {
    await rm(packDir, { recursive: true, force: true });
  });

  const { stdout } = await execFileAsync(
    "npm",
    ["pack", "--json", "--pack-destination", packDir],
    { maxBuffer: 1024 * 1024 },
  );
  const result = parsePackResult(stdout);
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    name: string;
    version: string;
    pi?: { extensions?: string[]; image?: string };
    publishConfig?: { access?: string };
  };
  const files = new Set(result.files.map((file) => file.path));

  assert.equal(result.name, manifest.name);
  assert.equal(result.version, manifest.version);
  assert.equal(
    result.filename,
    `${manifest.name.replaceAll("/", "-")}-${manifest.version}.tgz`.replace(
      /^@/,
      "",
    ),
  );
  assert.ok(files.has("package.json"));
  assert.ok(files.has("README.md"));
  assert.equal(result.size < 50_000, true);
  assert.equal(files.has("CHANGELOG.md"), false);
  assert.ok(files.has("LICENSE"));
  assert.ok(files.has("src/index.ts"));
  assert.equal(files.has("assets/alias.png"), false);
  assert.equal(files.has("RELEASE.md"), false);
  assert.equal(files.has("tsconfig.json"), false);
  assert.equal(
    [...files].some((file) => file.startsWith("test/")),
    false,
  );
  assert.equal(
    [...files].some((file) => file.startsWith(".github/")),
    false,
  );

  assert.deepEqual(manifest.pi?.extensions, ["./src/index.ts"]);
  assert.match(manifest.pi?.image ?? "", /^https:\/\//);
  assert.equal(manifest.publishConfig?.access, "public");
});

function parsePackResult(stdout: string): PackResult {
  const value: unknown = JSON.parse(stdout);
  assert.ok(Array.isArray(value));
  const items: unknown[] = value;
  assert.equal(items.length, 1);
  const [result] = items;
  assert.ok(isPackResult(result));
  return result;
}

function isPackResult(value: unknown): value is PackResult {
  if (!isRecord(value)) return false;
  return (
    typeof value.filename === "string" &&
    typeof value.name === "string" &&
    typeof value.version === "string" &&
    typeof value.size === "number" &&
    Array.isArray(value.files) &&
    value.files.every((file) => isRecord(file) && typeof file.path === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
