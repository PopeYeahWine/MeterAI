# Claude Code Instructions for MeterAI

## Release Process

**IMPORTANT:** When the user asks to build, release, or deploy the application:

1. **Always ask the user** which version type they want before proceeding:
   - **Patch** (x.x.X) - Bug fixes, minor changes
   - **Minor** (x.X.0) - New features, backwards compatible
   - **Major** (X.0.0) - Breaking changes

2. Use the version bump script:
   ```bash
   npm run version:patch   # or :minor or :major
   ```

3. Then commit, tag, and push:
   ```bash
   git add -A
   git commit -m "chore: bump version to X.X.X"
   git tag vX.X.X
   git push origin main --tags
   ```

## Version Files

The version is synchronized across these files (handled automatically by `scripts/bump-version.js`):
- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `README.md` (download filenames in the Installation section)

The frontend uses `__APP_VERSION__` injected by Vite at build time from `package.json`.

## GitHub Workflows

- **Release workflow** (`release.yml`): Triggered by pushing a `v*` tag
- **CI workflow** (`ci.yml`): Runs on push/PR to main
- **Version check** (`version-check.yml`): Validates version consistency across files
