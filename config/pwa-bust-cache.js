#!/usr/bin/env node

/**
 * PWA cache-bust helper.
 *
 * Patches client/dist/manifest.webmanifest icon URLs with a content-hash
 * version query and bumps the matching precache revision in client/dist/sw.js.
 * Needed because VitePWA's glob runs before post-build.cjs copies customization
 * icons into dist, so sw.js has no revision entries for them and the stable
 * filenames defeat HTTP / manifest icon caches across rebrands.
 *
 * Idempotent: the version is derived from the icon bytes, so re-running on
 * the same inputs produces identical output.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIST_DIR = path.resolve(__dirname, '..', 'client', 'dist');
const ICON_DIR = path.join(DIST_DIR, 'assets', 'customization');
const MANIFEST_PATH = path.join(DIST_DIR, 'manifest.webmanifest');
const SW_PATH = path.join(DIST_DIR, 'sw.js');

const ICON_EXT = /\.(png|ico|svg|jpg|jpeg|webp)$/i;
const SW_REVISION_PATTERN = /\{url:"manifest\.webmanifest",revision:"[a-f0-9]+"\}/g;

const log = (msg) => console.log(`[pwa-bust] ${msg}`);

function hashIconBytes() {
  const hash = crypto.createHash('sha256');
  const files = fs
    .readdirSync(ICON_DIR)
    .filter((name) => ICON_EXT.test(name))
    .sort();
  for (const name of files) {
    hash.update(name);
    hash.update(fs.readFileSync(path.join(ICON_DIR, name)));
  }
  return hash.digest('hex').slice(0, 12);
}

function withVersion(src, version) {
  return `${src.split('?')[0]}?v=${version}`;
}

function patchManifest(version) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
    return null;
  }
  manifest.icons = manifest.icons.map((icon) => ({
    ...icon,
    src: withVersion(icon.src, version),
  }));
  const serialized = JSON.stringify(manifest);
  fs.writeFileSync(MANIFEST_PATH, serialized);
  return serialized;
}

function patchServiceWorker(manifestBytes) {
  const src = fs.readFileSync(SW_PATH, 'utf8');
  if (!SW_REVISION_PATTERN.test(src)) {
    return null;
  }
  const revision = crypto.createHash('md5').update(manifestBytes).digest('hex');
  const patched = src.replace(
    SW_REVISION_PATTERN,
    `{url:"manifest.webmanifest",revision:"${revision}"}`,
  );
  fs.writeFileSync(SW_PATH, patched);
  return revision;
}

function run() {
  const missing = [ICON_DIR, MANIFEST_PATH, SW_PATH].filter((p) => !fs.existsSync(p));
  if (missing.length > 0) {
    log(`skipped: missing ${missing.join(', ')}`);
    return;
  }
  const version = hashIconBytes();
  const manifestBytes = patchManifest(version);
  if (!manifestBytes) {
    log('skipped: manifest has no icons');
    return;
  }
  const revision = patchServiceWorker(manifestBytes);
  if (!revision) {
    log(`version=${version} (sw.js had no manifest revision entry to patch)`);
    return;
  }
  log(`version=${version} revision=${revision}`);
}

try {
  run();
} catch (err) {
  console.error(`[pwa-bust] failed: ${err.message}`);
}
