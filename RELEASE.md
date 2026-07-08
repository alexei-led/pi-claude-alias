# Release

Do not publish until you are ready.

## One-time cleanup before first publish

Replace the placeholder metadata in `package.json`:

- `repository.url`
- `homepage`
- `bugs.url`

They currently use `TODO-OWNER` placeholders.

## Local release gate

Run the full local gate first:

```bash
npm install
npm run verify
npm run publish:dry
```

## Manual publish

If you want to publish by hand instead of GitHub Actions:

```bash
npm publish --provenance --access public
```

Requires:

- npm account with publish access for `pi-claude-alias`
- a recent npm CLI
- trusted publishing or a valid local npm auth session

## GitHub Actions publish flow

The included publish workflow triggers on `v*` tags.

Suggested flow:

```bash
npm version patch
git add package.json package-lock.json CHANGELOG.md
git commit -m "Release v$(node -p "require('./package.json').version")"
git tag "v$(node -p "require('./package.json').version")"
git push origin HEAD --tags
```

The workflow expects:

- repository secret: `NPM_TOKEN`
- tag format: `v<package.json version>`

It will:

1. install dependencies
2. run lint
3. run typecheck
4. run tests
5. run `npm pack --dry-run`
6. publish with `--provenance --access public`

## Safe pre-publish checklist

- `package.json` placeholder URLs replaced
- `npm run verify` clean
- `npm run publish:dry` clean
- `npm pack --dry-run` contains only intended files
- `pi install /absolute/path/to/pi-claude-alias` works in a temp `PI_CODING_AGENT_DIR`
- `pi -e /absolute/path/to/pi-claude-alias --list-models` shows both aliases with fake temp auth
