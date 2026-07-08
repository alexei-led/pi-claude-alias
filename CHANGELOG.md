# Changelog

## Unreleased

### Added

- Production-ready package metadata for `pi-claude-alias`
- Focused tests for alias registration, model copying, metadata preservation, auth separation, and package contents
- CI workflow for lint, typecheck, tests, and `npm pack --dry-run`
- Publish workflow for tagged npm releases with `NPM_TOKEN` and provenance
- Release guide and manual verification steps using a temporary `PI_CODING_AGENT_DIR`

### Changed

- Alias registration now derives login labels from Pi's built-in Anthropic OAuth provider name
- Alias registration now safely handles an empty built-in Anthropic catalog while still registering OAuth-capable providers
- Alias model refresh now tracks all copied metadata, not just ids and token limits
