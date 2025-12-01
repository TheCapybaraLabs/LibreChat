#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../client/src/locales');

const enPath = resolve(root, 'en/translation.json');
const targetLang = process.argv[2] || 'pt-BR';
const targetPath = resolve(root, targetLang, 'translation.json');

const PLACEHOLDER_PATTERNS = [/algo precisa ir aqui/i];

function load(path) {
  const raw = readFileSync(path, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`JSON parse error in ${path}: ${err.message}`);
    process.exit(1);
  }
}

const en = load(enPath);
const target = load(targetPath);

const enKeys = new Set(Object.keys(en));
const targetKeys = new Set(Object.keys(target));

const missing = [...enKeys].filter((k) => !targetKeys.has(k)).sort();
const extra = [...targetKeys].filter((k) => !enKeys.has(k)).sort();
const placeholders = Object.entries(target)
  .filter(([, v]) => typeof v === 'string' && PLACEHOLDER_PATTERNS.some((rx) => rx.test(v)))
  .map(([k]) => k)
  .sort();
const sameAsEn = [...targetKeys]
  .filter((k) => enKeys.has(k) && target[k] === en[k] && typeof target[k] === 'string')
  .sort();

const fmt = (label, list) => {
  console.log(`\n${label} (${list.length}):`);
  if (list.length === 0) {
    console.log('  (none)');
    return;
  }
  for (const k of list) {
    console.log(`  ${k}`);
  }
};

console.log(`Comparing en -> ${targetLang}`);
console.log(`  en keys:     ${enKeys.size}`);
console.log(`  ${targetLang} keys: ${targetKeys.size}`);

fmt(`Missing in ${targetLang} (in en but not in ${targetLang})`, missing);
fmt(`Extra in ${targetLang} (in ${targetLang} but not in en)`, extra);
fmt(`Placeholder values in ${targetLang}`, placeholders);
fmt(`Untranslated (same string as en) in ${targetLang}`, sameAsEn);

const issues = missing.length + extra.length + placeholders.length;
process.exit(issues > 0 ? 1 : 0);
