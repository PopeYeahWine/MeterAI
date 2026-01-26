<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="MeterAI Logo" width="80"/>
</p>

<h1 align="center">MeterAI</h1>

<p align="center">
  <strong>Track your AI usage in real-time</strong><br>
  A lightweight, privacy-first desktop widget for monitoring Claude, OpenAI, and other AI services.
</p>

<p align="center">
  <a href="https://github.com/PopeYeahWine/MeterAI/releases"><img src="https://img.shields.io/github/v/release/PopeYeahWine/MeterAI?style=flat-square&color=22F0B6" alt="Release"></a>
  <a href="https://github.com/PopeYeahWine/MeterAI/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square" alt="Platform">
</p>

---

## Screenshots

<p align="center">
  <img src="assets/screenshot-collapsed.png" alt="Collapsed Widget" width="500"/><br>
  <em>Compact always-on-top widget showing usage at a glance</em>
</p>

<p align="center">
  <img src="assets/screenshot-expanded.png" alt="Expanded View" width="350"/><br>
  <em>Expanded view with provider list, categories, and detailed usage</em>
</p>

<p align="center">
  <img src="assets/screenshot-settings.png" alt="Settings Panel" width="350"/><br>
  <em>Configuration panel with customizable thresholds</em>
</p>

---

## Key Features

- **Always-on-Top Widget** — Floating, draggable bar that stays visible while you work
- **Claude Code Integration** — Automatic OAuth-based tracking for Claude Pro/Max (no API key needed)
- **Rolling Window Timer** — Real-time countdown to your next usage reset (5-hour window)
- **Color Thresholds** — Visual indicators: green (OK), yellow (caution), orange (warning), red (critical)
- **Desktop Notifications** — Configurable alerts when you approach usage limits
- **System Tray Mode** — Minimize to tray, quick access from notification area
- **Multi-Provider Support** — Track 30+ AI services from a single dashboard
- **Privacy-First** — All data stored locally, no telemetry, no cloud sync
- **Cross-Platform** — Windows, macOS, and Linux support

---

## How It Works

1. **For Claude Pro/Max users**: MeterAI automatically detects your Claude Code credentials and fetches your real usage data via Anthropic's OAuth API
2. **For other providers**: Configure your API keys in the settings panel to enable tracking
3. **The widget displays**:
   - Current usage percentage with color-coded status
   - Time remaining until reset (rolling 5-hour window for Claude)
   - Quick access to expand/collapse and configure

### Usage Flow

```
┌─────────────────────────────────────────────────────────┐
│  MeterAI         Claude ████░░ 58%    ▼  ⓘ  —  ✕      │
│                        ⏱ 1h 39m                        │
└─────────────────────────────────────────────────────────┘
        ↓ Click chevron to expand
┌─────────────────────────────────────────────────────────┐
│  Provider List                                          │
│  ├── Coding & Development                               │
│  │   ├── Claude Pro/Max ████████░░ 58%                 │
│  │   ├── Claude API (coming soon)                       │
│  │   ├── OpenAI ChatGPT Plus/Pro                       │
│  │   └── GitHub Copilot                                │
│  ├── Chat                                               │
│  ├── Image                                              │
│  └── ...                                                │
└─────────────────────────────────────────────────────────┘
```

---

## Supported Providers

| Provider | Auth Method |
|----------|-------------|
| <img src="assets/icons/claude.svg" width="16" height="16" /> **Claude Pro/Max** | Auto-detect (Claude Code OAuth) |
| <img src="assets/icons/openai.svg" width="16" height="16" /> **OpenAI API** | API Key |

---

## Installation

### Download

| Platform | File | Download |
|----------|------|----------|
| Windows | `MeterAI_1.2.1_x64-setup.exe` | [Download](https://github.com/PopeYeahWine/MeterAI/releases/download/v1.2.0/MeterAI_1.2.1_x64-setup.exe) |
| Windows | `MeterAI_1.2.0_x64_en-US.msi` | [Download](https://github.com/PopeYeahWine/MeterAI/releases/download/v1.2.0/MeterAI_1.2.0_x64_en-US.msi) |
| macOS (Intel) | `MeterAI_1.2.1_x64.dmg` | [Download](https://github.com/PopeYeahWine/MeterAI/releases/download/v1.2.0/MeterAI_1.2.1_x64.dmg) |
| macOS (Apple Silicon) | `MeterAI_1.2.0_aarch64.dmg` | [Download](https://github.com/PopeYeahWine/MeterAI/releases/download/v1.2.0/MeterAI_1.2.0_aarch64.dmg) |
| Linux | `MeterAI_1.2.1_amd64.AppImage` | [Download](https://github.com/PopeYeahWine/MeterAI/releases/download/v1.2.0/MeterAI_1.2.1_amd64.AppImage) |
| Linux | `MeterAI_1.2.1_amd64.deb` | [Download](https://github.com/PopeYeahWine/MeterAI/releases/download/v1.2.0/MeterAI_1.2.1_amd64.deb) |

> You may see a Windows SmartScreen warning when running the installer. This is normal for applications pending code signing approval. See [Code Signing Policy](#code-signing-policy) below.

### Requirements

- **Windows**: Windows 10/11 (x64). WebView2 Runtime (usually pre-installed)
- **macOS**: macOS 10.15+ (Intel & Apple Silicon)
- **Linux**: Most distributions with GTK3 and WebKit2GTK

---

## Usage

### Quick Start

1. **Install and launch** MeterAI
2. **Claude Code users**: Your credentials are auto-detected — just enable tracking when prompted
3. **Other providers**: Click the chevron → select a provider → configure in settings
4. **Monitor** your usage in real-time from the floating widget

### System Tray

Right-click the tray icon for quick actions:
- **Show** — Bring widget to front
- **Quit** — Exit application

### Keyboard Shortcuts

- Click and drag the widget to reposition
- Click chevron (▼) to expand/collapse
- Click (ⓘ) for about and settings

---

## Privacy & Security

MeterAI is designed with privacy as a core principle:

- **Local-only storage** — All data stays on your machine
- **No telemetry** — We don't collect any usage data or analytics
- **No cloud sync** — Your configuration never leaves your device
- **Secure credential storage** — API keys stored in OS credential manager:
  - Windows: Credential Manager
  - macOS: Keychain
  - Linux: Secret Service API (GNOME Keyring / KWallet)
- **Open source audit** — Source code available for security review

### Data Location

| Platform | Path |
|----------|------|
| Windows | `%LOCALAPPDATA%\meter-ai\data.json` |
| macOS | `~/Library/Application Support/meter-ai/data.json` |
| Linux | `~/.local/share/meter-ai/data.json` |

---

## Development Roadmap

We're actively developing MeterAI. Below is our comprehensive development plan.

---

### Provider Integrations

| Feature | Status | Description |
|---------|--------|-------------|
| <img src="assets/icons/claude.svg" width="16" height="16" /> Claude API | 🔜 Coming Soon | API key usage tracking for Anthropic API |
| <img src="assets/icons/github-copilot.svg" width="16" height="16" /> GitHub Copilot | 🔜 Planned | OAuth integration for Copilot subscription usage |
| <img src="assets/icons/google-gemini.svg" width="16" height="16" /> Google Gemini | 🔜 Planned | OAuth integration for Gemini API |
| Multiple accounts | 🔜 Planned | Support tracking multiple accounts per provider |

---

### Usage Analytics & Data

| Feature | Priority | Description |
|---------|----------|-------------|
| **Usage history graph** | P1 | Sparkline or mini-chart displaying usage evolution over the past 24 hours or 7 days. Visualize trends at a glance directly in the widget. |
| **Depletion prediction** | P1 | Intelligent estimation of when your usage limit will be reached based on current consumption rate. Example: "At this pace, limit reached in 2h 15m". |
| **Budget tracking** | P2 | Define daily or monthly spending budgets in $ for paid APIs. Receive alerts when approaching or exceeding your budget. |
| **Export data (CSV/JSON)** | P2 | Export your complete usage history for external analysis, reporting, or backup purposes. |
| **Import/export config** | P2 | Backup and restore your entire configuration (thresholds, providers, settings) to easily migrate between devices. |

---

### Interface & User Experience

| Feature | Priority | Description |
|---------|----------|-------------|
| **Dark/Light themes** | P1 | Theme toggle with support for dark mode, light mode, and custom color schemes. Adjust transparency and accent colors. |
| **Mini-mode** | P1 | Ultra-compact display showing only a colored circle indicator. Percentage and details appear on hover. Minimal screen footprint. |
| **Multiple widgets** | P2 | Ability to detach and display multiple independent widgets, one per provider. Position them anywhere on screen. |
| **Smooth animations** | P2 | Fluid CSS transitions when state changes occur (e.g., warning → critical). Visual feedback for user actions. |
| **Global hotkeys** | P2 | System-wide keyboard shortcuts to show/hide the widget, force refresh data, or quickly switch between providers. |

---

### Notifications & Alerts

| Feature | Priority | Description |
|---------|----------|-------------|
| **Custom sounds** | P1 | Configurable audio alerts per threshold level. Different sounds for warning vs critical states. Option to mute specific providers. |
| **Scheduled summaries** | P2 | Periodic notification summaries. Example: "Daily recap at 6 PM" showing your usage across all providers for the day. |
| **Discord/Slack webhooks** | P2 | Send alerts to external services via webhooks. Get notified on Discord, Slack, or Microsoft Teams when thresholds are crossed. |

---

### Security & Reliability

| Feature | Priority | Description |
|---------|----------|-------------|
| **Local data encryption** | P1 | Encrypt the data.json file using OS-level protection (DPAPI on Windows, Keychain on macOS). Data remains protected even if the file is copied. |
| **Integrity verification** | P2 | SHA-256 hash verification of critical files on startup. Detect any corruption or unauthorized modification of configuration. |
| **Log rotation** | P2 | Automatic rotation and cleanup of log files to prevent disk space accumulation. Configurable retention period. |

---

### Integrations & Ecosystem

| Feature | Priority | Description |
|---------|----------|-------------|
| **VS Code extension** | P1 | Display your AI usage directly in the VS Code status bar. Quick access to usage stats without leaving your editor. |
| **Local REST API** | P2 | Expose a localhost HTTP endpoint allowing other applications to query your usage data programmatically. |
| **Stream Deck plugin** | P3 | Elgato Stream Deck integration displaying real-time usage on a physical button with color-coded status. |

---

### Premium Features (Future)

| Feature | Description |
|---------|-------------|
| **Cloud Sync** | Real-time usage synchronization across all your devices (desktop, mobile, web). Monitor your AI consumption from anywhere without needing Claude Code installed on every machine. Access your dashboard from any browser. |
| **Mobile app** | Companion application for iOS and Android. Check your usage on the go, receive push notifications, and manage settings remotely. |
| **Team dashboard** | Shared usage tracking for teams and organizations. Aggregate usage across team members, set team-wide budgets, and generate reports. |
| **Buy credits** | Purchase AI credits (Anthropic, OpenAI) directly from the MeterAI interface. Seamless top-up when running low. |

---

### Feature Requests

Have an idea? [Open an issue](https://github.com/PopeYeahWine/MeterAI/issues) with the `enhancement` label!

---

## Troubleshooting

### Widget doesn't start
- **Windows**: Install [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) if not present
- **Linux**: Ensure `libwebkit2gtk-4.0` is installed

### Claude Code not detected
- Make sure you're logged into Claude Code CLI or VS Code extension
- Check that `~/.claude/.credentials.json` exists
- Try the manual file picker in settings

### No notifications
- Check your OS notification settings
- Allow MeterAI in privacy/notification settings

---

## Contributing

MeterAI is open source under GPL-3.0-or-later. We welcome:
- Bug reports via [GitHub Issues](https://github.com/PopeYeahWine/MeterAI/issues)
- Feature suggestions and feedback
- Pull requests (see [CONTRIBUTING.md](CONTRIBUTING.md))
- Security vulnerability reports (see [SECURITY.md](SECURITY.md))

---

## Support the Project

If MeterAI helps you stay productive, consider supporting development:

**BTC**: `bc1qnav0zef8edpgtr0t7vkylyt0xly4vxzgwaerrt`

**USDC (ETH)**: `0xaE42e321F2672A072b2e7421FF0E6Aa117cCd667`

---

## Code Signing Policy

MeterAI has applied for free open-source code signing through [SignPath Foundation](https://signpath.org).

**Current status:** Pending approval

Once approved, Windows releases will be signed with a certificate provided by SignPath Foundation. Until then, you may see SmartScreen warnings when installing — this is expected for unsigned applications.

### Verification (after approval)

To verify a signed release:
1. Right-click the `.exe` or `.msi` file
2. Select **Properties** → **Digital Signatures** tab
3. Confirm the signature shows "SignPath Foundation"

### Team roles

- **Committers and reviewers:** [@PopeYeahWine](https://github.com/PopeYeahWine)
- **Approvers:** [@PopeYeahWine](https://github.com/PopeYeahWine)

### Privacy policy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

For detailed privacy information, see [PRIVACY.md](PRIVACY.md).

---

## License

This software is licensed under the **GNU General Public License v3.0 or later** (GPL-3.0-or-later).

You are free to use, modify, and distribute this software under the terms of the GPL. See [LICENSE](LICENSE) for full terms.

**Copyright (c) 2026 HPSC**

For inquiries: [@PopeYeahWine](https://github.com/PopeYeahWine)
