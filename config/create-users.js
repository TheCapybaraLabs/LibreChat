const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { User } = require('@librechat/data-schemas').createModels(mongoose);
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { registerUser } = require('~/server/services/AuthService');
const { silentExit } = require('./helpers');
const connect = require('./connect');

(async () => {
  await connect();

  console.purple('---------------------------------');
  console.purple('Bulk user creation from JSON file');
  console.purple('---------------------------------');

  let filePath;
  let globalEmailVerified;
  let globalPassword;
  let dryRun = false;

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--file=')) {
      filePath = arg.slice('--file='.length);
      continue;
    }
    if (arg.startsWith('--email-verified=')) {
      globalEmailVerified = arg.split('=')[1].toLowerCase() !== 'false';
      continue;
    }
    if (arg.startsWith('--password=')) {
      globalPassword = arg.slice('--password='.length);
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (!filePath && !arg.startsWith('--')) {
      filePath = arg;
    }
  }

  if (!filePath) {
    console.orange(
      'Usage: node config/create-users.js <file.json> [--password=<pass>] [--email-verified=true|false] [--dry-run]',
    );
    console.orange('');
    console.orange('JSON format:');
    console.orange('  [');
    console.orange('    { "email": "a@example.com", "name": "Alice", "username": "alice" },');
    console.orange(
      '    { "email": "b@example.com", "name": "Bob", "password": "secret", "emailVerified": false }',
    );
    console.orange('  ]');
    console.orange('');
    console.orange('Per-user "emailVerified" and "password" fields override the global flags.');
    console.orange('Password is auto-generated if omitted.');
    silentExit(1);
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.red('Error: File not found: ' + resolvedPath);
    silentExit(1);
  }

  let users;
  try {
    users = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch (err) {
    console.red('Error: Failed to parse JSON: ' + err.message);
    silentExit(1);
  }

  if (!Array.isArray(users) || users.length === 0) {
    console.red('Error: JSON must be a non-empty array of user objects.');
    silentExit(1);
  }

  const validationErrors = [];
  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const email = typeof u.email === 'string' ? u.email.trim().toLowerCase() : '';
    if (!email || !email.includes('@')) {
      validationErrors.push(`[${i}] Invalid or missing email: ${u.email}`);
    } else {
      u.email = email;
    }
  }
  if (validationErrors.length > 0) {
    console.red('Validation errors:');
    for (const err of validationErrors) {
      console.red('  ' + err);
    }
    silentExit(1);
  }

  if (dryRun) {
    console.orange('Dry run — no users will be created.');
  }

  const results = { created: [], skipped: [], dryRun: [], failed: [] };

  for (const u of users) {
    const email = u.email;
    const defaultName = email.split('@')[0];
    const name = u.name ?? defaultName;
    const username = u.username ?? defaultName;
    const emailVerified = u.emailVerified ?? globalEmailVerified ?? true;
    const provider = u.provider;
    let password = u.password ?? globalPassword;
    let generated = false;

    if (!password) {
      password = Math.random().toString(36).slice(-18);
      generated = true;
    }

    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      console.orange(`  [skip] ${email} — email or username already exists`);
      results.skipped.push(email);
      continue;
    }

    if (dryRun) {
      console.cyan(
        `  [dry-run] ${email} (name: ${name}, username: ${username}, emailVerified: ${emailVerified})`,
      );
      results.dryRun.push(email);
      continue;
    }

    try {
      const result = await registerUser(
        { email, password, name, username, confirm_password: password, provider },
        { emailVerified },
      );

      if (result.status !== 200) {
        console.red(`  [fail] ${email} — ${result.message}`);
        results.failed.push({ email, reason: result.message });
        continue;
      }

      if (generated) {
        console.green(`  [ok] ${email} — password: ${password}`);
      } else {
        console.green(`  [ok] ${email}`);
      }
      results.created.push(email);
    } catch (err) {
      console.red(`  [fail] ${email} — ${err.message}`);
      results.failed.push({ email, reason: err.message });
    }
  }

  console.purple('---------------------------------');
  if (dryRun) {
    console.cyan(`Dry-run : ${results.dryRun.length}`);
  } else {
    console.green(`Created : ${results.created.length}`);
  }
  console.orange(`Skipped : ${results.skipped.length}`);
  if (!dryRun) {
    console.red(`Failed  : ${results.failed.length}`);
    for (const f of results.failed) {
      console.red(`  ${f.email}: ${f.reason}`);
    }
  }
  console.purple('---------------------------------');

  silentExit(results.failed.length > 0 ? 1 : 0);
})();

process.on('uncaughtException', (err) => {
  if (!err.message.includes('fetch failed')) {
    console.error('There was an uncaught error:');
    console.error(err);
  }

  if (err.message.includes('fetch failed')) {
    return;
  } else {
    process.exit(1);
  }
});
