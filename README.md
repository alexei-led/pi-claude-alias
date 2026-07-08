# pi-claude-alias

[![Pi extension](https://img.shields.io/badge/pi-extension-6f42c1)](#install)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Use more than one Claude subscription in Pi without logging in and out of the same provider.

## Problem

Pi's built-in `anthropic` provider has one auth slot.
If you use several Claude accounts, they fight over the same login.

## What this package does

You define any number of Claude aliases in `claude-alias.json`.
Each alias:

- reuses Pi's built-in Anthropic OAuth flow
- reuses Pi's built-in Anthropic model catalog
- gets its own OAuth credential slot
- gets a short handle like `claude-work`

It also publishes a footer status like:

```text
claude-work · opus-4.8
```

That shows up cleanly in `pi-powerline-footer` through extension status integration.

`pi-fusion` can use the same handles in profile model specs, for example:

```json
{ "model": "claude-work/opus-4.8" }
```

## Config

Global config:

```text
~/.pi/agent/claude-alias.json
```

Project override:

```text
.pi/claude-alias.json
```

Example:

```json
{
  "aliases": [
    { "slug": "work", "label": "Work", "handle": "claude-work" },
    { "slug": "personal", "label": "Personal", "handle": "claude-me" }
  ]
}
```

This creates provider ids:

- `anthropic-work`
- `anthropic-personal`

Handle names must stay unique across global and project config files.

## Install

```bash
pi install /absolute/path/to/pi-claude-alias
```

Or after publish:

```bash
pi install npm:pi-claude-alias
```

## Use

Login each alias separately:

```text
/login anthropic-work
/login anthropic-personal
```

Then select models normally:

```text
/model anthropic-work/claude-opus-4-8
/model anthropic-personal/claude-sonnet-4-6
```

## Notes

- No proxy.
- No router.
- No failover.
- No billing tricks.
- Just separate Anthropic auth slots with useful names.
