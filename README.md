# MeterAI

Multi-provider AI usage tracker - Monitor your Claude, OpenAI, and other AI API usage in real-time.

![Preview](docs/preview.png)

## Features

- **Multi-Provider Support**: Track usage for Anthropic (Claude), OpenAI (ChatGPT), and manual tracking
- **Always-on-Top Widget**: Floating, draggable, and unobtrusive
- **Real-Time Monitoring**: Usage percentage, remaining requests, countdown to reset
- **Windows/macOS Notifications**: Configurable alerts at custom thresholds (70%, 90%, 100%)
- **System Tray Integration**: Quick access from notification area
- **History Tracking**: View past usage periods
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
2. Click the **lightning icon** to open Providers settings
3. Configure your preferred provider(s):
   - **Manual**: Count requests manually (no API key needed)
   - **Anthropic (Claude)**: Enter your Anthropic API key
   - **OpenAI (ChatGPT)**: Enter your OpenAI API key
4. Click on a provider to select it as active
5. Use **+1 Requete** / **+5** to track your usage

### System Tray

Right-click the tray icon for quick actions:
- **Afficher**: Show widget
- **+1 / +5 Requetes**: Quick increment
- **Reset quota**: Reset counter
- **Quitter**: Exit application

### Configuration

For each provider, you can configure:
- **API Key**: Your provider API key (stored securely)
- **Limit per period**: Maximum requests (default: 100)
- **Reset period**: Interval in hours (default: 4h)
- **Alert thresholds**: Notification percentages (default: 70, 90, 100)

### Data Storage

Your data is stored locally:
- **Windows**: `%LOCALAPPDATA%\meter-ai\data.json`
- **macOS**: `~/Library/Application Support/meter-ai/data.json`
- **Linux**: `~/.local/share/meter-ai/data.json`

API keys are stored in the OS secure credential manager (never in plain text).

---

## For Developers

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://rustup.rs/) (for compiling Tauri)
- Platform-specific dependencies:
  - **Windows**: Visual Studio Build Tools with C++ workload
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `build-essential`, `libgtk-3-dev`, `libwebkit2gtk-4.0-dev`, `libssl-dev`

### Setup

```bash
# Clone the repository
git clone https://github.com/PopeYeahWine/MeterAI.git
cd MeterAI

# Install dependencies
npm install

# Run in development mode
npm run tauri:dev
```

### Build for Production

```bash
# Build the application
npm run tauri:build
```

Output locations:
- **Windows**: `src-tauri/target/release/meter-ai.exe`
- **macOS**: `src-tauri/target/release/bundle/dmg/`
- **Linux**: `src-tauri/target/release/bundle/appimage/`

### Project Structure

```
MeterAI/
├── src/                    # Frontend (React + TypeScript)
│   ├── App.tsx             # Main component
│   ├── main.tsx            # Entry point
│   └── styles.css          # Styles
├── src-tauri/              # Backend (Rust + Tauri)
│   ├── src/main.rs         # Main logic & providers
│   ├── Cargo.toml          # Rust dependencies
│   ├── tauri.conf.json     # Tauri configuration
│   └── icons/              # App icons
├── package.json
└── README.md
```

### Adding a New Provider

1. Add the provider type in `src-tauri/src/main.rs`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProviderType {
    Manual,
    Anthropic,
    OpenAI,
    NewProvider,  // Add here
}
```

2. Initialize the provider in `AppState::default()`

3. Update the frontend in `src/App.tsx`:
   - Add icon and color in `getProviderIcon()` and `getProviderColor()`

### Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Backend**: Rust, Tauri 1.5
- **Secure Storage**: `keyring` crate (OS credential manager)
- **Notifications**: `notify-rust` crate

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
- Ensure icon files exist in `src-tauri/icons/`

---

## License

MIT
