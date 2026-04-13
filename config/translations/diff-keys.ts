import fs from 'fs';
import path from 'path';

const LOCALES_DIR = path.resolve('client/src/locales');
const BASE_LANG = 'en';

function readKeys(lang: string): string[] {
  const file = path.join(LOCALES_DIR, lang, 'translation.json');
  const content = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
  return Object.keys(content);
}

function diff(base: string[], target: string[]): { missing: string[]; extra: string[] } {
  const baseSet = new Set(base);
  const targetSet = new Set(target);
  return {
    missing: base.filter((k) => !targetSet.has(k)),
    extra: target.filter((k) => !baseSet.has(k)),
  };
}

function main(targetLang: string) {
  const baseKeys = readKeys(BASE_LANG);
  const targetKeys = readKeys(targetLang);
  const { missing, extra } = diff(baseKeys, targetKeys);

  console.log(`Base: ${BASE_LANG} (${baseKeys.length} keys)`);
  console.log(`Target: ${targetLang} (${targetKeys.length} keys)`);
  console.log(`Missing in ${targetLang}: ${missing.length}`);
  console.log(`Extra in ${targetLang} (not in ${BASE_LANG}): ${extra.length}`);

  if (missing.length > 0) {
    console.log(`\n--- Missing keys in ${targetLang} ---`);
    for (const k of missing) {
      console.log(k);
    }
  }

  if (extra.length > 0) {
    console.log(`\n--- Extra keys in ${targetLang} (not in ${BASE_LANG}) ---`);
    for (const k of extra) {
      console.log(k);
    }
  }
}

const target = process.argv[2] ?? 'pt-BR';
main(target);
