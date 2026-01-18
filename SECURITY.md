# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability in MeterAI, please report it responsibly.

### How to Report

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. Contact [@PopeYeahWine](https://github.com/PopeYeahWine) directly via GitHub
3. Or create a private security advisory on GitHub

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

### Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial assessment:** Within 1 week
- **Fix timeline:** Depends on severity, typically 1-4 weeks

### Responsible Disclosure

We kindly ask that you:
- Give us reasonable time to fix the issue before public disclosure
- Do not exploit the vulnerability beyond what's necessary to demonstrate it
- Do not access or modify other users' data

## Security Measures

MeterAI implements the following security practices:

### Credential Storage
- API keys are stored in the operating system's secure credential manager:
  - Windows: Windows Credential Manager
  - macOS: Keychain
  - Linux: Secret Service API (GNOME Keyring, KWallet)
- Keys are **never** stored in plain text files

### Network Security
- All API communications use HTTPS
- Content Security Policy (CSP) restricts allowed connections
- HTTP requests are scoped to specific API endpoints only

### Application Security
- No remote code execution capabilities
- No external scripts loaded
- Minimal permissions requested
- No telemetry or data collection

## Code Signing

Official releases are signed using certificates provided by [SignPath Foundation](https://signpath.org).

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## License

MeterAI is open source under GPL-3.0-or-later. You can audit the source code at:
https://github.com/PopeYeahWine/MeterAI

Thank you for helping keep MeterAI secure!
