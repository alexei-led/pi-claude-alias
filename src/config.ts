import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROVIDER_SPECS,
  isProviderName,
  type ProviderName,
} from "./providers.js";
import { errorMessage, isRecord } from "./shared.js";

const SUB_ALIASES_CONFIG_FILE = "sub-aliases.json";
const DEFAULT_PROVIDER: ProviderName = "anthropic";

export type AliasDefinition = {
  provider: ProviderName;
  slug: string;
  providerId: string;
  handle: string;
  label: string;
};

export type AliasLoadOptions = {
  cwd?: string;
  projectTrusted?: boolean;
  agentDir?: string;
};

export type AliasLoadResult = {
  aliases: AliasDefinition[];
  errors: string[];
};

export function getGlobalAliasConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, SUB_ALIASES_CONFIG_FILE);
}

export function getProjectAliasConfigPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, SUB_ALIASES_CONFIG_FILE);
}

export function loadAliases(options: AliasLoadOptions = {}): AliasLoadResult {
  const global = parseAliasFile(getGlobalAliasConfigPath(options.agentDir));
  const project =
    options.cwd && options.projectTrusted
      ? parseAliasFile(getProjectAliasConfigPath(options.cwd))
      : { aliases: [], errors: [] };

  const merged = mergeAliases(global.aliases, project.aliases);
  const validated = validateMergedAliases(merged);

  return {
    aliases: validated.aliases,
    errors: [...global.errors, ...project.errors, ...validated.errors],
  };
}

export function parseAliasConfig(raw: string, source: string): AliasLoadResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return {
      aliases: [],
      errors: [`Invalid JSON in ${source}: ${errorMessage(error)}`],
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

  const aliases: AliasDefinition[] = [];
  const errors: string[] = [];

  for (const [index, entry] of aliasesValue.entries()) {
    const parsed = parseAliasEntry(entry);
    if ("alias" in parsed) {
      aliases.push(parsed.alias);
    } else {
      errors.push(
        `Invalid alias entry at ${source} aliases[${index}]: ${parsed.error}.`,
      );
    }
  }

  return { aliases, errors };
}

function parseAliasFile(path: string): AliasLoadResult {
  if (!existsSync(path)) {
    return { aliases: [], errors: [] };
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return {
      aliases: [],
      errors: [`Cannot read alias config at ${path}: ${errorMessage(error)}`],
    };
  }

  return parseAliasConfig(raw, path);
}

function parseAliasEntry(
  value: unknown,
): { alias: AliasDefinition } | { error: string } {
  if (!isRecord(value)) {
    return { error: "expected an object" };
  }

  const provider =
    value.provider === undefined ? DEFAULT_PROVIDER : value.provider;
  if (!isProviderName(provider)) {
    return { error: `unknown provider ${JSON.stringify(value.provider)}` };
  }

  const slug = normalizeSlug(value.slug);
  if (!slug) {
    return { error: "missing or invalid slug" };
  }

  const spec = PROVIDER_SPECS[provider];
  return {
    alias: {
      provider,
      slug,
      providerId: `${spec.builtin}-${slug}`,
      handle: normalizeSlug(value.handle) ?? `${spec.handlePrefix}-${slug}`,
      label: normalizeLabel(value.label) ?? titleCaseSlug(slug),
    },
  };
}

// providerId is derived 1:1 from (provider, slug), so keying on it merges
// project entries over global ones per (provider, slug).
function mergeAliases(
  globalAliases: readonly AliasDefinition[],
  projectAliases: readonly AliasDefinition[],
): AliasDefinition[] {
  const merged = new Map<string, AliasDefinition>();

  for (const alias of [...globalAliases, ...projectAliases]) {
    merged.set(alias.providerId, alias);
  }

  return [...merged.values()];
}

function validateMergedAliases(
  aliases: readonly AliasDefinition[],
): AliasLoadResult {
  const errors: string[] = [];
  const seenHandles = new Set<string>();
  const valid: AliasDefinition[] = [];

  for (const alias of aliases) {
    if (seenHandles.has(alias.handle)) {
      errors.push(`Duplicate alias handle: ${alias.handle}`);
      continue;
    }

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
