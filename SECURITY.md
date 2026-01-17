# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in MeterAI, please report it responsibly.

### How to Report

1. **DO NOT** create a public GitHub issue for security vulnerabilities
2. Contact the author directly via GitHub: [@PopeYeahWine](https://github.com/PopeYeahWine)
3. Provide a detailed description of the vulnerability
4. Include steps to reproduce if possible

### What to Expect

- Acknowledgment within 48 hours
- Regular updates on the investigation progress
- Credit in the release notes (if desired) once the vulnerability is fixed

## Security Measures

MeterAI implements the following security measures:

### API Key Storage
- API keys are stored in the operating system's secure credential manager
- Windows: Windows Credential Manager
- macOS: Keychain
- Linux: Secret Service API (GNOME Keyring, KWallet)
- Keys are **never** stored in plain text files

### Network Security
- All API communications use HTTPS
- Content Security Policy (CSP) restricts allowed connections
- HTTP requests are scoped to specific API endpoints only:
  - `https://api.anthropic.com/*`
  - `https://api.openai.com/*`
  - `https://api.github.com/*`

### Application Security
- No remote code execution capabilities
- No external scripts loaded
- Minimal permissions requested (window, notification, process, http)
- No file system access beyond app data directory

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |
| < Latest| :x:                |

Only the latest release receives security updates.

---

**Copyright (c) 2026 HPSC - All Rights Reserved**
