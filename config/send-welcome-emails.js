#!/usr/bin/env node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { User } = require('@librechat/data-schemas').createModels(mongoose);
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { sendEmail } = require('~/server/utils');
const { askQuestion, silentExit } = require('./helpers');
const connect = require('./connect');

const TEMPLATE = 'welcomeEmail.handlebars';

async function gracefulExit(code = 0) {
  try {
    await mongoose.disconnect();
  } catch (err) {
    console.error('Error disconnecting from MongoDB:', err);
  }
  silentExit(code);
}

function parseArgs(argv) {
  const opts = {
    subject: 'Bem-vindo(a) ao {{appName}}',
    onlyVerified: false,
    onlyUnverified: false,
    filePath: null,
    dryRun: false,
    skipConfirm: false,
    delayMs: 100,
    appUrl: process.env.DOMAIN_CLIENT || process.env.APP_URL || '',
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--subject=')) {
      opts.subject = arg.slice('--subject='.length);
      continue;
    }
    if (arg.startsWith('--file=')) {
      opts.filePath = arg.slice('--file='.length);
      continue;
    }
    if (arg.startsWith('--delay=')) {
      const n = parseInt(arg.slice('--delay='.length), 10);
      if (!Number.isNaN(n) && n >= 0) {
        opts.delayMs = n;
      }
      continue;
    }
    if (arg.startsWith('--app-url=')) {
      opts.appUrl = arg.slice('--app-url='.length);
      continue;
    }
    if (arg === '--only-verified') {
      opts.onlyVerified = true;
      continue;
    }
    if (arg === '--only-unverified') {
      opts.onlyUnverified = true;
      continue;
    }
    if (arg === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (arg === '--yes' || arg === '-y') {
      opts.skipConfirm = true;
      continue;
    }
  }
  return opts;
}

function printUsage() {
  console.orange(
    'Usage: node config/send-welcome-emails.js [--file=<emails.json>] [--subject="..."] [--app-url=<url>] [--only-verified|--only-unverified] [--delay=<ms>] [--dry-run] [--yes]',
  );
  console.orange('');
  console.orange('Without --file, sends to ALL users in the DB.');
  console.orange('');
  console.orange('Optional --file JSON (either form is accepted):');
  console.orange('  ["a@example.com", "b@example.com"]');
  console.orange('  or');
  console.orange('  [{ "email": "a@example.com" }, { "email": "b@example.com" }]');
  console.orange('');
  console.orange('Subject supports {{appName}} placeholder.');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadEmailAllowlist(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.red('Error: File not found: ' + resolved);
    return null;
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (err) {
    console.red('Error: Failed to parse JSON: ' + err.message);
    return null;
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    console.red('Error: JSON must be a non-empty array.');
    return null;
  }
  const emails = new Set();
  for (const item of raw) {
    const rawEmail = typeof item === 'string' ? item : item?.email;
    if (typeof rawEmail === 'string' && rawEmail.includes('@')) {
      emails.add(rawEmail.trim().toLowerCase());
    }
  }
  return emails;
}

(async () => {
  await connect();

  console.purple('---------------------------------');
  console.purple('Sending welcome emails');
  console.purple('---------------------------------');

  const opts = parseArgs(process.argv);

  if (opts.onlyVerified && opts.onlyUnverified) {
    console.red('Error: --only-verified and --only-unverified are mutually exclusive.');
    return gracefulExit(1);
  }

  if (!process.env.EMAIL_FROM) {
    console.red('Error: EMAIL_FROM is not set. Configure SMTP or Mailgun env vars first.');
    printUsage();
    return gracefulExit(1);
  }

  const appName = process.env.APP_TITLE || 'LabsChat';

  let allowlist = null;
  if (opts.filePath) {
    allowlist = await loadEmailAllowlist(opts.filePath);
    if (!allowlist) {
      return gracefulExit(1);
    }
  }

  const query = {};
  if (opts.onlyVerified) {
    query.emailVerified = true;
  } else if (opts.onlyUnverified) {
    query.emailVerified = { $ne: true };
  }
  if (allowlist) {
    query.email = { $in: Array.from(allowlist) };
  }

  const users = await User.find(query).select('_id email name username emailVerified').lean();
  if (users.length === 0) {
    console.yellow('No users matched the given filters.');
    return gracefulExit(0);
  }

  console.cyan(`Matched ${users.length} user(s).`);
  if (opts.dryRun) {
    console.orange('Dry run — no emails will be sent.');
  } else if (!opts.skipConfirm) {
    const confirm = await askQuestion(
      `Send welcome email ("${opts.subject.replace('{{appName}}', appName)}") to ${users.length} user(s)? (y/N)`,
    );
    if (confirm.toLowerCase() !== 'y') {
      console.yellow('Aborted.');
      return gracefulExit(0);
    }
  }

  const subject = opts.subject.replace('{{appName}}', appName);
  const results = { sent: [], dryRun: [], failed: [] };

  for (const user of users) {
    const email = user.email;
    const name = user.name || user.username || email.split('@')[0];

    if (opts.dryRun) {
      console.cyan(`  [dry-run] ${email} (name: ${name})`);
      results.dryRun.push(email);
      continue;
    }

    try {
      await sendEmail({
        email,
        subject,
        payload: {
          appName,
          name,
          appUrl: opts.appUrl || '',
          year: new Date().getFullYear(),
        },
        template: TEMPLATE,
      });
      console.green(`  [ok] ${email}`);
      results.sent.push(email);
    } catch (err) {
      console.red(`  [fail] ${email} — ${err.message}`);
      results.failed.push({ email, reason: err.message });
    }

    if (opts.delayMs > 0) {
      await sleep(opts.delayMs);
    }
  }

  console.purple('---------------------------------');
  if (opts.dryRun) {
    console.cyan(`Dry-run: ${results.dryRun.length}`);
  } else {
    console.green(`Sent   : ${results.sent.length}`);
    console.red(`Failed : ${results.failed.length}`);
    for (const f of results.failed) {
      console.red(`  ${f.email}: ${f.reason}`);
    }
  }
  console.purple('---------------------------------');

  return gracefulExit(results.failed.length > 0 ? 1 : 0);
})().catch(async (err) => {
  console.error('There was an uncaught error:');
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch (_e) {
    // best-effort cleanup; already in fatal error path
  }
  process.exit(1);
});
