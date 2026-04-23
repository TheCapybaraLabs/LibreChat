#!/usr/bin/env node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { User } = require('@librechat/data-schemas').createModels(mongoose);
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { sendEmail } = require('~/server/utils');
const { askQuestion, askSecret, silentExit } = require('./helpers');
const connect = require('./connect');

const TEMPLATE = 'welcomeEmail.handlebars';
const SENT_LOG_PATH = path.join(__dirname, '.sent-welcome-emails.json');
const SEND_INTERVAL_MS = 600;
const MAX_ATTEMPTS = 3;
const INVALID_NAME_CHARS = /[\r\n"]/;

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
    ignoreSent: false,
    help: false,
    createdAfter: null,
    createdBefore: null,
    password: null,
    promptPassword: false,
    appUrl: process.env.DOMAIN_CLIENT || process.env.APP_URL || '',
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg.startsWith('--subject=')) {
      opts.subject = arg.slice('--subject='.length);
    } else if (arg.startsWith('--file=')) {
      opts.filePath = arg.slice('--file='.length);
    } else if (arg.startsWith('--email=')) {
      opts.email = arg.slice('--email='.length).trim().toLowerCase();
    } else if (arg.startsWith('--app-url=')) {
      opts.appUrl = arg.slice('--app-url='.length);
    } else if (arg.startsWith('--created-after=')) {
      opts.createdAfter = arg.slice('--created-after='.length);
    } else if (arg.startsWith('--created-before=')) {
      opts.createdBefore = arg.slice('--created-before='.length);
    } else if (arg === '--password') {
      opts.promptPassword = true;
    } else if (arg.startsWith('--password=')) {
      opts.password = arg.slice('--password='.length);
    } else if (arg === '--only-verified') {
      opts.onlyVerified = true;
    } else if (arg === '--only-unverified') {
      opts.onlyUnverified = true;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--yes' || arg === '-y') {
      opts.skipConfirm = true;
    } else if (arg === '--ignore-sent') {
      opts.ignoreSent = true;
    }
  }
  return opts;
}

function printUsage() {
  console.orange(
    'Usage: node config/send-welcome-emails.js [--email=<addr> | --file=<emails.json>] [--subject="..."] [--app-url=<url>] [--only-verified|--only-unverified] [--password[=<pwd>]] [--ignore-sent] [--dry-run] [--yes] [--help]',
  );
  console.orange('');
  console.orange('Flags:');
  console.orange('  --email=<addr>     Send to exactly one user. Mutually exclusive with --file.');
  console.orange('  --file=<path>      JSON file restricting which users receive the email.');
  console.orange('                     Without --file or --email, sends to ALL users in the DB.');
  console.orange('  --subject="..."    Email subject. Supports {{appName}} placeholder.');
  console.orange('                     Default: "Bem-vindo(a) ao {{appName}}".');
  console.orange(
    '  --app-url=<url>    URL for the CTA button. Defaults to DOMAIN_CLIENT or APP_URL env.',
  );
  console.orange('  --only-verified    Skip users whose emailVerified flag is false.');
  console.orange('  --only-unverified  Only send to users whose emailVerified flag is false.');
  console.orange('  --created-after=<d>  Only users whose createdAt >= d (YYYY-MM-DD or ISO).');
  console.orange('  --created-before=<d> Only users whose createdAt <= d (YYYY-MM-DD or ISO).');
  console.orange(
    "  --password=<pwd>   Shared provisional password. Verified against each user's current",
  );
  console.orange(
    '                     DB hash — users whose current password differs are skipped.',
  );
  console.orange(
    '                     Visible in `ps`/shell history; prefer bare --password in prod.',
  );
  console.orange(
    '  --password         Prompt for the password interactively (not echoed, hidden from ps).',
  );
  console.orange('  --ignore-sent      Resend even to users logged in .sent-welcome-emails.json.');
  console.orange('  --dry-run          Preview matched users without sending anything.');
  console.orange('                     (Note: still connects to Mongo to resolve filters.)');
  console.orange('  --yes / -y         Skip the top-level confirmation prompt.');
  console.orange('  --help / -h        Show this help and exit.');
  console.orange('');
  console.orange('Names containing CR, LF, or double-quote fall back to the email local-part.');
  console.orange('JSON file (--file): flat array of emails, or objects with an "email" field.');
  console.orange(
    `Pacing: ${SEND_INTERVAL_MS}ms between send starts (stays under Resend's 2 req/s cap).`,
  );
  console.orange(
    `Retries: transient failures (429, timeouts, DNS) retried up to ${MAX_ATTEMPTS} times with backoff.`,
  );
  console.orange('Ctrl-C disconnects Mongo cleanly; press twice to force.');
  console.orange('Required env: EMAIL_FROM (plus SMTP or Mailgun config).');
  console.orange(
    'Optional env: SUPPORT_EMAIL (shown in the email footer), APP_TITLE, DOMAIN_CLIENT.',
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransient(err) {
  const msg = err?.message || '';
  return /\b429\b|rate.?limit|timeout|ECONN|ETIMEDOUT|ESOCKET|EAI_AGAIN/i.test(msg);
}

async function sendWithRetry(params) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await sendEmail(params);
    } catch (err) {
      if (attempt === MAX_ATTEMPTS || !isTransient(err)) {
        throw err;
      }
      const backoffMs = attempt * 1000;
      console.orange(`  [retry ${attempt}] ${params.email} in ${backoffMs}ms — ${err.message}`);
      await sleep(backoffMs);
    }
  }
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

let interrupted = false;
process.on('SIGINT', () => {
  if (interrupted) {
    process.exit(130);
  }
  interrupted = true;
  console.yellow('\nInterrupted. Cleaning up (Ctrl-C again to force).');
  gracefulExit(130).catch(() => process.exit(130));
});

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
  if (opts.promptPassword && opts.password) {
    console.red('Error: pass either --password=<pwd> or bare --password (prompt), not both.');
    return gracefulExit(1);
  }
  if (opts.promptPassword) {
    opts.password = await askSecret('Enter provisional password (not echoed):');
    if (!opts.password) {
      console.red('Error: empty password.');
      return gracefulExit(1);
    }
  }

  let createdAfter = null;
  let createdBefore = null;
  if (opts.createdAfter) {
    createdAfter = new Date(opts.createdAfter);
    if (Number.isNaN(createdAfter.getTime())) {
      console.red(`Error: --created-after value "${opts.createdAfter}" is not a valid date.`);
      return gracefulExit(1);
    }
  }
  if (opts.createdBefore) {
    createdBefore = new Date(opts.createdBefore);
    if (Number.isNaN(createdBefore.getTime())) {
      console.red(`Error: --created-before value "${opts.createdBefore}" is not a valid date.`);
      return gracefulExit(1);
    }
  }
  if (createdAfter && createdBefore && createdAfter > createdBefore) {
    console.red('Error: --created-after must be <= --created-before.');
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
  if (createdAfter || createdBefore) {
    query.createdAt = {};
    if (createdAfter) {
      query.createdAt.$gte = createdAfter;
    }
    if (createdBefore) {
      query.createdAt.$lte = createdBefore;
    }
  }

  const selectFields = opts.password
    ? '_id email name username emailVerified +password'
    : '_id email name username emailVerified';
  const allUsers = await User.find(query).select(selectFields).lean();
  if (allUsers.length === 0) {
    console.yellow('No users matched the given filters.');
    return gracefulExit(0);
  }

  const sentLog = loadSentLog();
  let users = opts.ignoreSent
    ? allUsers
    : allUsers.filter((u) => !Object.prototype.hasOwnProperty.call(sentLog, u.email));
  const skippedCount = allUsers.length - users.length;

  if (skippedCount > 0) {
    console.orange(
      `Skipping ${skippedCount} user(s) previously sent (${path.basename(SENT_LOG_PATH)}). Use --ignore-sent to resend.`,
    );
  }

  if (opts.password && users.length > 0) {
    const checks = await Promise.all(
      users.map(async (u) => {
        const matches = u.password ? await bcrypt.compare(opts.password, u.password) : false;
        return { user: u, matches };
      }),
    );
    const mismatched = checks.filter((c) => !c.matches).length;
    if (mismatched > 0) {
      console.orange(
        `Skipping ${mismatched} user(s) whose current DB password does not match --password.`,
      );
    }
    users = checks.filter((c) => c.matches).map((c) => c.user);
  }

  if (users.length === 0) {
    console.yellow('Nothing to send — no users remain after filters.');
    return gracefulExit(0);
  }

  const estimatedSec = Math.round((users.length * SEND_INTERVAL_MS) / 1000);
  console.cyan(
    `Matched ${users.length} user(s) (~${estimatedSec}s paced at ${SEND_INTERVAL_MS}ms).`,
  );
  if (opts.password) {
    console.orange('Each email will include a provisional password (value redacted).');
  }
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
  let lastStartAt = 0;

  for (const user of users) {
    const email = user.email;
    const candidate = user.name || user.username || '';
    const name = candidate && !INVALID_NAME_CHARS.test(candidate) ? candidate : email.split('@')[0];

    if (opts.dryRun) {
      console.cyan(`  [dry-run] ${email} (name: ${name})`);
      results.dryRun.push(email);
      continue;
    }

    const waitMs = Math.max(0, lastStartAt + SEND_INTERVAL_MS - Date.now());
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    lastStartAt = Date.now();

    try {
      await sendWithRetry({
        email,
        subject,
        payload: {
          appName,
          name,
          appUrl: opts.appUrl || '',
          password: opts.password || '',
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
    // best-effort cleanup
  }
  process.exit(1);
});
