# MeterAI

Multi-provider AI usage tracker - Monitor your Claude, OpenAI, and other AI API usage in real-time.

![Preview](docs/preview.png)

---

## License & Legal Notice

**This software is proprietary and source-available (NOT open source).**

The source code is made available solely for:
- Transparency
- Security auditing
- Verification purposes

### You may NOT:
- Use this software for any purpose
- Modify this software
- Compile or build this software
- Distribute this software in any form
- Include this software or any portion of it in other projects
- Use this software commercially or non-commercially
- Create derivative works based on this software
- Fork this repository for any purpose other than viewing

**All rights reserved. Copyright (c) 2026 HPSC**

For licensing inquiries, commercial use, or partnerships, please contact: [@PopeYeahWine](https://github.com/PopeYeahWine)

See the [LICENSE](LICENSE) file for the full legal text.

---

## Features

- **Multi-Provider Support**: Track usage for Anthropic (Claude), OpenAI (ChatGPT), and 30+ AI services
- **Claude Code Integration**: Automatic OAuth-based usage tracking for Claude Pro/Max subscribers
- **Always-on-Top Widget**: Floating, draggable, and unobtrusive
- **Real-Time Monitoring**: Usage percentage, remaining requests, countdown to reset
- **Auto-Update Check**: Daily GitHub release check with in-app notification
- **Windows/macOS Notifications**: Configurable alerts at custom thresholds (70%, 90%, 100%)
- **System Tray Integration**: Quick access from notification area
- **Secure API Key Storage**: Keys stored in OS credential manager (Windows Credential Manager / macOS Keychain)
- **Cross-Platform**: Windows, macOS, and Linux support

---

## For Users (Installation)

**No development tools required!** Download and install like any regular application.

### Download

Go to [Releases](https://github.com/PopeYeahWine/MeterAI/releases) and download:

| Platform | File |
|----------|------|
| Windows | `MeterAI_x.x.x_x64-setup.exe` or `MeterAI_x.x.x_x64_en-US.msi` |
| macOS | `MeterAI_x.x.x_x64.dmg` |
| Linux | `MeterAI_x.x.x_amd64.AppImage` or `.deb` |

### Quick Start

1. Install and launch MeterAI
2. Click the **chevron** to expand the provider list
3. Claude Code users: Your usage is detected automatically via OAuth
4. Other providers: Configure API keys in the settings
5. Monitor your usage in real-time!

### System Tray

Right-click the tray icon for quick actions:
- **Show**: Show widget
- **Hide**: Hide widget
- **Quit**: Exit application

### Data Storage

Your data is stored locally:
- **Windows**: `%LOCALAPPDATA%\meter-ai\data.json`
- **macOS**: `~/Library/Application Support/meter-ai/data.json`
- **Linux**: `~/.local/share/meter-ai/data.json`

API keys are stored in the OS secure credential manager (never in plain text).

---

## FAQ

### Is the binary self-contained?

**Yes.** The built application is completely standalone. End users do not need Node.js, Rust, or any development tools installed. Tauri compiles everything into a single native binary.

### How are API keys secured?

API keys are stored in your operating system's credential manager:
- **Windows**: Windows Credential Manager
- **macOS**: Keychain
- **Linux**: Secret Service API (GNOME Keyring, KWallet)

Keys are never stored in plain text files.

### Cross-platform compatibility?

MeterAI works on:
- Windows 10/11 (x64)
- macOS 10.15+ (x64, ARM via Rosetta)
- Linux (most distributions with GTK3)

---

## Troubleshooting

### Widget doesn't start
- **Windows**: Install [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) if not present
- **Linux**: Ensure `libwebkit2gtk-4.0` is installed

### No notifications
- Check your OS notification settings
- Allow the application in privacy settings

### Missing tray icon
- Ensure the application is running
- Check system tray settings

---

## Support & Contact

- **Issues & Bug Reports**: [GitHub Issues](https://github.com/PopeYeahWine/MeterAI/issues)
- **Contact**: [@PopeYeahWine](https://github.com/PopeYeahWine)

### Support Development

If you find this tool useful:

**BTC**: `bc1qnav0zef8edpgtr0t7vkylyt0xly4vxzgwaerrt`

**USDC (ETH)**: `0xaE42e321F2672A072b2e7421FF0E6Aa117cCd667`

---

## Security

For security vulnerabilities, please see [SECURITY.md](SECURITY.md).

---

**Copyright (c) 2026 HPSC - All Rights Reserved**
