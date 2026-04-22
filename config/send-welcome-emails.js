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
const SENT_LOG_PATH = path.join(__dirname, '.sent-welcome-emails.json');

function loadSentLog() {
  if (!fs.existsSync(SENT_LOG_PATH)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(SENT_LOG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    console.orange(
      `Warning: failed to parse ${SENT_LOG_PATH} (${err.message}). Treating as empty.`,
    );
    return {};
  }
}

function recordSent(sentLog, email) {
  sentLog[email] = new Date().toISOString();
  try {
    fs.writeFileSync(SENT_LOG_PATH, JSON.stringify(sentLog, null, 2) + '\n');
  } catch (err) {
    console.red(`Warning: failed to persist ${SENT_LOG_PATH}: ${err.message}`);
  }
}

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
    email: null,
    dryRun: false,
    skipConfirm: false,
    help: false,
    delayMs: 2000,
    jitterMs: 0,
    batchSize: 0,
    batchPauseMs: 0,
    appUrl: process.env.DOMAIN_CLIENT || process.env.APP_URL || '',
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (arg.startsWith('--subject=')) {
      opts.subject = arg.slice('--subject='.length);
      continue;
    }
    if (arg.startsWith('--file=')) {
      opts.filePath = arg.slice('--file='.length);
      continue;
    }
    if (arg.startsWith('--email=')) {
      opts.email = arg.slice('--email='.length).trim().toLowerCase();
      continue;
    }
    if (arg.startsWith('--delay=')) {
      const n = parseInt(arg.slice('--delay='.length), 10);
      if (!Number.isNaN(n) && n >= 0) {
        opts.delayMs = n;
      }
      continue;
    }
    if (arg.startsWith('--jitter=')) {
      const n = parseInt(arg.slice('--jitter='.length), 10);
      if (!Number.isNaN(n) && n >= 0) {
        opts.jitterMs = n;
      }
      continue;
    }
    if (arg.startsWith('--batch-size=')) {
      const n = parseInt(arg.slice('--batch-size='.length), 10);
      if (!Number.isNaN(n) && n > 0) {
        opts.batchSize = n;
      }
      continue;
    }
    if (arg.startsWith('--batch-pause=')) {
      const n = parseInt(arg.slice('--batch-pause='.length), 10);
      if (!Number.isNaN(n) && n >= 0) {
        opts.batchPauseMs = n;
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
    'Usage: node config/send-welcome-emails.js [--email=<addr> | --file=<emails.json>] [--subject="..."] [--app-url=<url>] [--only-verified|--only-unverified] [--delay=<ms>] [--dry-run] [--yes] [--help]',
  );
  console.orange('');
  console.orange('Flags:');
  console.orange('  --email=<addr>     Send to exactly one user. Mutually exclusive with --file.');
  console.orange('  --file=<path>      JSON file restricting which users receive the email.');
  console.orange('                     Without --file or --email, sends to ALL users in the DB.');
  console.orange('  --subject="..."    Email subject. Supports {{appName}} placeholder.');
  console.orange(`                     Default: "Bem-vindo(a) ao {{appName}}".`);
  console.orange(
    '  --app-url=<url>    URL for the CTA button in the email. Defaults to DOMAIN_CLIENT or APP_URL env.',
  );
  console.orange('  --only-verified    Skip users whose emailVerified flag is false.');
  console.orange('  --only-unverified  Only send to users whose emailVerified flag is false.');
  console.orange('  --delay=<ms>       Base delay between sends. Default 2000ms.');
  console.orange(
    '  --jitter=<ms>      Add random 0..jitter ms to each delay (defeats cadence detection).',
  );
  console.orange(
    '  --batch-size=<N>   Send N emails, then pause (see --batch-pause). Default off.',
  );
  console.orange('  --batch-pause=<ms> Pause this long between batches. Use with --batch-size.');
  console.orange('  --dry-run          Preview matched users without sending anything.');
  console.orange('  --yes / -y         Skip the top-level confirmation prompt.');
  console.orange('  --help / -h        Show this help and exit.');
  console.orange('');
  console.orange('JSON file shape (--file):');
  console.orange('  Either a flat array of email strings:');
  console.orange('    [');
  console.orange('      "alice@example.com",');
  console.orange('      "bob@example.com"');
  console.orange('    ]');
  console.orange('');
  console.orange('  Or an array of objects (only the "email" field is read):');
  console.orange('    [');
  console.orange('      { "email": "alice@example.com" },');
  console.orange('      { "email": "bob@example.com" }');
  console.orange('    ]');
  console.orange('');
  console.orange('  Both forms can be mixed in the same file. Emails are normalized to lowercase.');
  console.orange('  Users present in the JSON but not in the DB are silently skipped.');
  console.orange('');
  console.orange('Required env: EMAIL_FROM (plus SMTP or Mailgun config).');
  console.orange('');
  console.orange('Anti-spam tips for bulk sends (e.g. classroom rollout):');
  console.orange(
    '  - Defaults already throttle to 2s/email. Bump --delay if your provider rate-limits.',
  );
  console.orange('  - Add --jitter=1500 so intervals are 2.0–3.5s (less bot-like cadence).');
  console.orange('  - For 30+ recipients, send in waves: --batch-size=10 --batch-pause=60000.');
  console.orange('  - Make sure SPF/DKIM/DMARC are aligned for the EMAIL_FROM domain.');
  console.orange('  - Smoke-test first: --email=<your-own@addr> --yes to verify deliverability.');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m${seconds}s`;
}

function estimateTotalDuration(count, opts) {
  if (count <= 1) {
    return 0;
  }
  const avgPerEmail = opts.delayMs + opts.jitterMs / 2;
  const baseDelays = (count - 1) * avgPerEmail;
  if (opts.batchSize > 0 && opts.batchPauseMs > 0) {
    const batches = Math.max(0, Math.floor((count - 1) / opts.batchSize));
    return baseDelays + batches * opts.batchPauseMs;
  }
  return baseDelays;
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

  if (opts.help) {
    printUsage();
    return gracefulExit(0);
  }

  if (opts.onlyVerified && opts.onlyUnverified) {
    console.red('Error: --only-verified and --only-unverified are mutually exclusive.');
    return gracefulExit(1);
  }

  if (opts.email && opts.filePath) {
    console.red('Error: --email and --file are mutually exclusive.');
    return gracefulExit(1);
  }

  if (opts.email && !opts.email.includes('@')) {
    console.red(`Error: --email value "${opts.email}" is not a valid email address.`);
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
  } else if (opts.email) {
    allowlist = new Set([opts.email]);
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

  const allUsers = await User.find(query).select('_id email name username emailVerified').lean();
  if (allUsers.length === 0) {
    console.yellow('No users matched the given filters.');
    return gracefulExit(0);
  }

  const sentLog = loadSentLog();
  const alreadySent = opts.ignoreSent
    ? []
    : allUsers.filter((u) => Object.prototype.hasOwnProperty.call(sentLog, u.email));
  const users = opts.ignoreSent
    ? allUsers
    : allUsers.filter((u) => !Object.prototype.hasOwnProperty.call(sentLog, u.email));

  if (alreadySent.length > 0) {
    console.orange(
      `Skipping ${alreadySent.length} user(s) previously sent (in .sent-welcome-emails.json). Use --ignore-sent to resend.`,
    );
  }

  if (users.length === 0) {
    console.yellow('Nothing to send — every matched user has already received the email.');
    return gracefulExit(0);
  }

  const estimatedMs = estimateTotalDuration(users.length, opts);
  const estimateLabel = estimatedMs > 0 ? ` (~${formatDuration(estimatedMs)} total)` : '';

  console.cyan(`Matched ${users.length} user(s)${estimateLabel}.`);
  if (opts.dryRun) {
    console.orange('Dry run — no emails will be sent.');
  } else if (!opts.skipConfirm) {
    const confirm = await askQuestion(
      `Send welcome email ("${opts.subject.replace('{{appName}}', appName)}") to ${users.length} user(s)${estimateLabel}? (y/N)`,
    );
    if (confirm.toLowerCase() !== 'y') {
      console.yellow('Aborted.');
      return gracefulExit(0);
    }
  }

  const subject = opts.subject.replace('{{appName}}', appName);
  const results = { sent: [], dryRun: [], failed: [] };
  let sentInBatch = 0;

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
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
      recordSent(sentLog, email);
    } catch (err) {
      console.red(`  [fail] ${email} — ${err.message}`);
      results.failed.push({ email, reason: err.message });
    }

    sentInBatch++;
    const isLast = i === users.length - 1;
    if (isLast) {
      continue;
    }

    if (opts.batchSize > 0 && sentInBatch >= opts.batchSize && opts.batchPauseMs > 0) {
      console.cyan(
        `  ...batch of ${opts.batchSize} sent — pausing ${formatDuration(opts.batchPauseMs)}`,
      );
      await sleep(opts.batchPauseMs);
      sentInBatch = 0;
      continue;
    }

    if (opts.delayMs > 0 || opts.jitterMs > 0) {
      const wait = opts.delayMs + Math.floor(Math.random() * (opts.jitterMs + 1));
      if (wait > 0) {
        await sleep(wait);
      }
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
