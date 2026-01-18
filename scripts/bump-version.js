#!/usr/bin/env node
/**
 * Bump version across all config files
 * Usage: node scripts/bump-version.js [patch|minor|major|x.y.z]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const FILES = {
  'package.json': {
    path: path.join(ROOT, 'package.json'),
    update: (content, version) => {
      const json = JSON.parse(content);
      json.version = version;
      return JSON.stringify(json, null, 2) + '\n';
    },
    getVersion: (content) => JSON.parse(content).version
  },
  'tauri.conf.json': {
    path: path.join(ROOT, 'src-tauri', 'tauri.conf.json'),
    update: (content, version) => {
      const json = JSON.parse(content);
      json.package.version = version;
      return JSON.stringify(json, null, 2) + '\n';
    },
    getVersion: (content) => JSON.parse(content).package.version
  },
  'Cargo.toml': {
    path: path.join(ROOT, 'src-tauri', 'Cargo.toml'),
    update: (content, version) => {
      return content.replace(/^version = ".*"/m, `version = "${version}"`);
    },
    getVersion: (content) => {
      const match = content.match(/^version = "(.*)"/m);
      return match ? match[1] : null;
    }
  }
};

function parseVersion(version) {
  const parts = version.split('.').map(Number);
  return { major: parts[0], minor: parts[1], patch: parts[2] };
}

function bumpVersion(current, type) {
  const v = parseVersion(current);
  switch (type) {
    case 'major':
      return `${v.major + 1}.0.0`;
    case 'minor':
      return `${v.major}.${v.minor + 1}.0`;
    case 'patch':
      return `${v.major}.${v.minor}.${v.patch + 1}`;
    default:
      // Assume it's a specific version
      if (/^\d+\.\d+\.\d+$/.test(type)) {
        return type;
      }
      throw new Error(`Invalid version type: ${type}`);
  }
}

function main() {
  const arg = process.argv[2];

  if (!arg) {
    // Show current versions
    console.log('\n📦 Current versions:\n');
    for (const [name, config] of Object.entries(FILES)) {
      const content = fs.readFileSync(config.path, 'utf8');
      const version = config.getVersion(content);
      console.log(`  ${name}: ${version}`);
    }
    console.log('\nUsage: node scripts/bump-version.js [patch|minor|major|x.y.z]\n');
    return;
  }

  // Get current version from package.json
  const pkgContent = fs.readFileSync(FILES['package.json'].path, 'utf8');
  const currentVersion = FILES['package.json'].getVersion(pkgContent);

  // Calculate new version
  const newVersion = bumpVersion(currentVersion, arg);

  console.log(`\n🔄 Bumping version: ${currentVersion} → ${newVersion}\n`);

  // Update all files
  for (const [name, config] of Object.entries(FILES)) {
    const content = fs.readFileSync(config.path, 'utf8');
    const oldVersion = config.getVersion(content);
    const newContent = config.update(content, newVersion);
    fs.writeFileSync(config.path, newContent);
    console.log(`  ✅ ${name}: ${oldVersion} → ${newVersion}`);
  }

  console.log(`\n✨ Done! Don't forget to:\n`);
  console.log(`  1. git add -A`);
  console.log(`  2. git commit -m "chore: bump version to ${newVersion}"`);
  console.log(`  3. git tag v${newVersion}`);
  console.log(`  4. git push origin main --tags\n`);
}

main();
