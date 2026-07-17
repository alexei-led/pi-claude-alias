import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
// Resolve against the repo root so the test works from any cwd.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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
  const packDir = await mkdtemp(join(tmpdir(), "pi-sub-aliases-pack-"));
  t.after(async () => {
    await rm(packDir, { recursive: true, force: true });
  });

  const { stdout } = await execFileAsync(
    "npm",
    ["pack", "--json", "--pack-destination", packDir],
    { cwd: REPO_ROOT, maxBuffer: 1024 * 1024 },
  );
  const result = parsePackResult(stdout);
  const manifest = parsePackageManifest(
    await readFile(join(REPO_ROOT, "package.json"), "utf8"),
  );
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
  assert.ok(result.size < 50_000);
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

  assert.deepEqual(manifest.pi.extensions, ["./src/index.ts"]);
  assert.match(manifest.pi.image ?? "", /^https:\/\//);
  assert.equal(manifest.publishConfig?.access, "public");
});

interface PackageManifest {
  name: string;
  version: string;
  pi: { extensions?: string[]; image?: string };
  publishConfig?: { access?: string };
}

function parsePackageManifest(raw: string): PackageManifest {
  const value: unknown = JSON.parse(raw);
  assert.ok(isPackageManifest(value));
  return value;
}

function parsePackResult(stdout: string): PackResult {
  const value: unknown = JSON.parse(stdout);
  // npm <12 emits an array; npm 12 emits an object keyed by package name.
  const items: unknown[] = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.values(value)
      : [];
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

function isPackageManifest(value: unknown): value is PackageManifest {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.version === "string" &&
    isRecord(value.pi) &&
    (value.pi.extensions === undefined ||
      (Array.isArray(value.pi.extensions) &&
        value.pi.extensions.every((item) => typeof item === "string"))) &&
    (value.pi.image === undefined || typeof value.pi.image === "string") &&
    (value.publishConfig === undefined ||
      (isRecord(value.publishConfig) &&
        (value.publishConfig.access === undefined ||
          typeof value.publishConfig.access === "string")))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
