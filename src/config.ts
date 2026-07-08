import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CLAUDE_ALIAS_CONFIG_FILE = "claude-alias.json";

export interface ClaudeAliasDefinition {
  slug: string;
  providerId: string;
  handle: string;
  label: string;
}

export interface ClaudeAliasLoadOptions {
  cwd?: string;
  projectTrusted?: boolean;
  agentDir?: string;
}

export interface ClaudeAliasLoadResult {
  aliases: ClaudeAliasDefinition[];
  errors: string[];
}

interface ParsedAliasFile {
  aliases: ClaudeAliasDefinition[] | undefined;
  errors: string[];
}

export function getGlobalClaudeAliasConfigPath(
  agentDir = getAgentDir(),
): string {
  return join(agentDir, CLAUDE_ALIAS_CONFIG_FILE);
}

export function getProjectClaudeAliasConfigPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, CLAUDE_ALIAS_CONFIG_FILE);
}

export function loadClaudeAliases(
  options: ClaudeAliasLoadOptions = {},
): ClaudeAliasLoadResult {
  const global = parseAliasFile(
    getGlobalClaudeAliasConfigPath(options.agentDir),
  );
  const project =
    options.cwd && options.projectTrusted
      ? parseAliasFile(getProjectClaudeAliasConfigPath(options.cwd))
      : { aliases: undefined, errors: [] };

  const merged = mergeAliases(global.aliases, project.aliases);
  const validated = validateMergedAliases(merged);

  return {
    aliases: validated.aliases,
    errors: [...global.errors, ...project.errors, ...validated.errors],
  };
}

export function parseClaudeAliasConfig(
  raw: string,
  source: string,
): ClaudeAliasLoadResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      aliases: [],
      errors: [`Invalid JSON in ${source}: ${message}`],
    };
  }

  if (!isRecord(value)) {
    return {
      aliases: [],
      errors: [`Invalid alias config at ${source}: expected an object.`],
    };
  }

  const aliasesValue = value.aliases;
  if (!Array.isArray(aliasesValue)) {
    return {
      aliases: [],
      errors: [
        `Invalid alias config at ${source}: expected aliases to be an array.`,
      ],
    };
  }

  const aliases: ClaudeAliasDefinition[] = [];
  const errors: string[] = [];

  for (const [index, entry] of aliasesValue.entries()) {
    const parsed = parseClaudeAliasEntry(entry);
    if (parsed) {
      aliases.push(parsed);
    } else {
      errors.push(`Invalid alias entry at ${source} aliases[${index}].`);
    }
  }

  return { aliases, errors };
}

function parseAliasFile(path: string): ParsedAliasFile {
  if (!existsSync(path)) {
    return { aliases: undefined, errors: [] };
  }

  const result = parseClaudeAliasConfig(readFileSync(path, "utf8"), path);
  return { aliases: result.aliases, errors: result.errors };
}

function parseClaudeAliasEntry(
  value: unknown,
): ClaudeAliasDefinition | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const slug = normalizeSlug(value.slug);
  if (!slug) {
    return undefined;
  }

  const label = normalizeLabel(value.label) ?? titleCaseSlug(slug);
  const handle = normalizeHandle(value.handle) ?? `claude-${slug}`;

  return {
    slug,
    providerId: `anthropic-${slug}`,
    handle,
    label,
  };
}

function mergeAliases(
  globalAliases: ClaudeAliasDefinition[] | undefined,
  projectAliases: ClaudeAliasDefinition[] | undefined,
): ClaudeAliasDefinition[] {
  const merged = new Map<string, ClaudeAliasDefinition>();

  for (const alias of globalAliases ?? []) {
    merged.set(alias.slug, alias);
  }
  for (const alias of projectAliases ?? []) {
    merged.set(alias.slug, alias);
  }

  return [...merged.values()];
}

function validateMergedAliases(
  aliases: readonly ClaudeAliasDefinition[],
): ClaudeAliasLoadResult {
  const errors: string[] = [];
  const seenProviderIds = new Set<string>();
  const seenHandles = new Set<string>();
  const valid: ClaudeAliasDefinition[] = [];

  for (const alias of aliases) {
    if (seenProviderIds.has(alias.providerId)) {
      errors.push(`Duplicate provider id: ${alias.providerId}`);
      continue;
    }
    if (seenHandles.has(alias.handle)) {
      errors.push(`Duplicate alias handle: ${alias.handle}`);
      continue;
    }

    seenProviderIds.add(alias.providerId);
    seenHandles.add(alias.handle);
    valid.push(alias);
  }

  return { aliases: valid, errors };
}

function normalizeSlug(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || undefined;
}

function normalizeHandle(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const handle = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return handle || undefined;
}

function normalizeLabel(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const label = value.trim();
  return label || undefined;
}

function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
