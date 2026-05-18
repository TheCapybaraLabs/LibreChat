#!/usr/bin/env node

/**
 * Runtime app-title rewrite.
 *
 * Patches client/dist/manifest.webmanifest (name, short_name) so a single
 * image built with the placeholder "LabsChat" can be rebranded per deployment
 * via the APP_TITLE env var. Must run before pwa-bust-cache.js so the
 * service-worker precache revision reflects the patched manifest.
 *
 * Idempotent: re-running with the same APP_TITLE is a no-op.
 */

const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_PATH = path.resolve(__dirname, '..', 'client', 'dist', 'manifest.webmanifest');
const PLACEHOLDER = 'LabsChat';

const PREFIX = '[apply-app-title]';
const logger = {
  info: (msg) => console.log(`${PREFIX} ${msg}`),
  warn: (msg) => console.warn(`${PREFIX} ${msg}`),
  error: (msg) => console.error(`${PREFIX} ${msg}`),
};

function patchManifest(target) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (manifest.name === target && manifest.short_name === target) {
    return false;
  }
  manifest.name = target;
  manifest.short_name = target;
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest));
  return true;
}

function run() {
  const target = (process.env.APP_TITLE || '').trim();
  if (!target || target === PLACEHOLDER) {
    logger.warn(`skipped: APP_TITLE ${target ? 'matches placeholder' : 'unset'}`);
    return;
  }
  if (!fs.existsSync(MANIFEST_PATH)) {
    logger.warn(`skipped: missing ${MANIFEST_PATH}`);
    return;
  }
  const changed = patchManifest(target);
  logger.info(`target="${target}" manifest=${changed ? 'patched' : 'noop'}`);
}

try {
  run();
} catch (err) {
  logger.error(`failed: ${err.message}`);
}
