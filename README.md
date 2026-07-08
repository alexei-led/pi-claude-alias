# pi-claude-alias

[![Pi extension](https://img.shields.io/badge/pi-extension-6f42c1)](#install)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Use multiple Claude subscriptions in Pi without logging in and out of the built-in `anthropic` provider.

Pi has one OAuth slot per provider id. This extension creates named Anthropic provider aliases. Each alias reuses Pi's built-in Anthropic OAuth flow and model catalog, but stores credentials separately.

Example result:

```text
anthropic-work/claude-opus-4-8
anthropic-personal/claude-sonnet-4-6
```

The active alias is also exposed to extension status integrations such as `pi-powerline-footer`:

```text
claude-work · opus-4.8
```

## Install

```bash
pi install npm:pi-claude-alias
```

For local development:

```bash
pi install /absolute/path/to/pi-claude-alias
```

## Config

Create `~/.pi/agent/claude-alias.json`:

```json
{
  "aliases": [
    { "slug": "work", "label": "Work", "handle": "claude-work" },
    { "slug": "personal", "label": "Personal", "handle": "claude-me" }
  ]
}
```

Optional project override:

```text
.pi/claude-alias.json
```

Rules:

- `slug` creates the provider id: `anthropic-<slug>`
- `label` is shown during OAuth login
- `handle` is used by integrations such as `pi-fusion`
- handles must be unique across global and project config files

## Use

Login once per alias:

```text
/login anthropic-work
/login anthropic-personal
```

Select models normally:

```text
/model anthropic-work/claude-opus-4-8
/model anthropic-personal/claude-sonnet-4-6
```

`pi-fusion` can use handles as shorthand:

```json
{ "model": "claude-work/opus-4.8" }
```

## Non-goals

No proxy. No router. No failover. No quota logic. Just separate Anthropic auth slots with useful names.
