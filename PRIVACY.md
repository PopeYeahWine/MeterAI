# Privacy Policy

**Last updated:** January 2026

## Summary

MeterAI is designed with privacy as a core principle. **This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.**

## Data Collection

MeterAI does **not** collect, transmit, or share any user data. Specifically:

- **No telemetry** — We do not collect usage statistics or analytics
- **No tracking** — We do not track user behavior or interactions
- **No cloud sync** — Your configuration and data never leave your device
- **No third-party services** — We do not integrate with analytics or advertising platforms

## Data Storage

All data is stored locally on your device:

| Platform | Location |
|----------|----------|
| Windows | `%LOCALAPPDATA%\meter-ai\data.json` |
| macOS | `~/Library/Application Support/meter-ai/data.json` |
| Linux | `~/.local/share/meter-ai/data.json` |

## Network Requests

MeterAI only makes network requests when:

1. **Fetching usage data** — When you enable tracking for a provider, MeterAI contacts that provider's API to retrieve your usage information
2. **Checking for updates** — MeterAI may check GitHub releases for available updates (this can be disabled)

These requests are initiated by user action and go directly to the respective service providers (e.g., Anthropic API for Claude usage). MeterAI does not proxy or intercept this data.

## Credential Storage

API keys and OAuth tokens are stored securely using your operating system's credential manager:

- **Windows:** Credential Manager
- **macOS:** Keychain
- **Linux:** Secret Service API (GNOME Keyring / KWallet)

## Open Source

MeterAI is open source under GPL-3.0-or-later. You can audit the source code at any time:
- Repository: https://github.com/PopeYeahWine/MeterAI

## Contact

For privacy-related questions, please open an issue on GitHub or contact [@PopeYeahWine](https://github.com/PopeYeahWine).
