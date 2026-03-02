# MeterAI for VS Code

MeterAI for VS Code is intentionally minimal: it shows Claude Code and OpenAI Codex usage directly in the status bar.
If you want a richer and more visual experience, use the MeterAI desktop app from GitHub.

## Features

- Automatic provider detection (Claude Code and/or Codex)
- Battery-style usage meter (`║████║`) with remaining percentage
- Reset countdown visible inline in the status bar
- Manual refresh command and configurable auto-refresh interval
- Local-first parsing of Claude/Codex session data (no API key required)
- No local file paths or project paths shown in status bar or tooltip

## Screenshots

### VS Code Extension (minimal status bar UI)

VS Code displays MeterAI in a compact, text-based status bar format:

![MeterAI VS Code - Status Bar](https://raw.githubusercontent.com/PopeYeahWine/MeterAI/main/vscode-extension/media/screenshot-vscode-statusbar.png)

When credits are running low, the battery turns red so you can see at a glance:

![MeterAI VS Code - Low Credits Warning](https://raw.githubusercontent.com/PopeYeahWine/MeterAI/main/vscode-extension/media/screenshot-vscode-low-credits.png)

### MeterAI Desktop (full visual UI)

For a richer interface with a full visual dashboard, use the desktop application:

![MeterAI Desktop - Expanded](https://raw.githubusercontent.com/PopeYeahWine/MeterAI/main/vscode-extension/media/screenshot-desktop-expanded.png)
![MeterAI Desktop - Collapsed](https://raw.githubusercontent.com/PopeYeahWine/MeterAI/main/vscode-extension/media/screenshot-desktop-collapsed.png)

## Want a richer visual app?

- VS Code extension = fast, compact, rudimentary status bar view
- Desktop app = full visual interface
- Repository: https://github.com/PopeYeahWine/MeterAI
- Desktop releases: https://github.com/PopeYeahWine/MeterAI/releases

## Install

After publication, install from the Visual Studio Code Marketplace:

```bash
code --install-extension hpsc-sas.meterai-vscode
```

## Package and Publish

```bash
cd vscode-extension
npm install
npm run package
```

Then publish (requires Azure DevOps PAT configured for `vsce`):

```bash
npm run publish:vsce
```

## Development

```bash
cd vscode-extension
npm install
npm run compile
```

In VS Code:

1. Open the `vscode-extension` folder.
2. Press `F5` to launch the Extension Development Host.
3. Run `MeterAI: Refresh Usage` from the Command Palette.

## Settings

- `meterai.statusBar.refreshIntervalSeconds`: auto-refresh interval (seconds)
- `meterai.statusBar.showClaude`: show Claude usage
- `meterai.statusBar.showCodex`: show Codex usage
- `meterai.statusBar.showResetCountdown`: show reset countdown
- `meterai.statusBar.checkExtensionUpdatesOnStartup`: trigger update check on VS Code startup

## Privacy

MeterAI reads local Claude/Codex data required to compute usage. It does not display local file paths in the UI.
