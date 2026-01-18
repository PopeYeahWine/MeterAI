# Contributing to MeterAI

Thank you for your interest in contributing to MeterAI! This document provides guidelines for contributing to the project.

## Code of Conduct

Please be respectful and constructive in all interactions. We welcome contributors of all skill levels and backgrounds.

## How to Contribute

### Reporting Bugs

1. Check if the issue already exists in [GitHub Issues](https://github.com/PopeYeahWine/MeterAI/issues)
2. If not, create a new issue with:
   - Clear description of the bug
   - Steps to reproduce
   - Expected vs actual behavior
   - Your OS and MeterAI version

### Feature Requests

Open an issue with the `enhancement` label describing:
- The feature you'd like to see
- Why it would be useful
- Any implementation ideas you have

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test thoroughly
5. Commit with clear messages (`git commit -m 'Add amazing feature'`)
6. Push to your fork (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Development Setup

```bash
# Clone the repository
git clone https://github.com/PopeYeahWine/MeterAI.git
cd MeterAI

# Install dependencies
npm install

# Run in development mode
npm run tauri:dev

# Build for production
npm run tauri:build
```

## Code Style

- Follow existing code patterns
- Use TypeScript for frontend code
- Use Rust for Tauri backend code
- Keep commits focused and atomic

## Code Signing

Official releases are signed via [SignPath Foundation](https://signpath.org). Only maintainer-approved builds from GitHub Actions are signed.

## License

By contributing, you agree that your contributions will be licensed under the GPL-3.0-or-later license.

## Questions?

Feel free to open an issue or reach out to [@PopeYeahWine](https://github.com/PopeYeahWine).
