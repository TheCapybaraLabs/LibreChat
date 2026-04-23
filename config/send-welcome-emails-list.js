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

const INVALID_NAME_CHARS = /[\r\n"]/;

async function gracefulExit(code = 0) {
  if (mongoose.connection?.readyState) {
    try {
      await mongoose.disconnect();
    } catch (err) {
      console.error('Error disconnecting from MongoDB:', err);
    }
  }
  silentExit(code);
}

const TEMPLATE = 'welcomeEmail.handlebars';
const SENT_LOG_PATH = path.join(__dirname, '.sent-welcome-emails.json');
const SEND_INTERVAL_MS = 600;
const MAX_ATTEMPTS = 3;

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

function parseArgs(argv) {
  const opts = {
    subject: 'Bem-vindo(a) ao {{appName}}',
    filePath: null,
    dryRun: false,
    skipConfirm: false,
    ignoreSent: false,
    help: false,
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
    } else if (arg.startsWith('--app-url=')) {
      opts.appUrl = arg.slice('--app-url='.length);
    } else if (arg === '--password') {
      opts.promptPassword = true;
    } else if (arg.startsWith('--password=')) {
      opts.password = arg.slice('--password='.length);
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
    'Usage: node config/send-welcome-emails-list.js --file=<recipients.json> [--subject="..."] [--app-url=<url>] [--password[=<pwd>]] [--ignore-sent] [--dry-run] [--yes] [--help]',
  );
  console.orange('');
  console.orange('Flags:');
  console.orange('  --file=<path>      JSON file with recipients. REQUIRED.');
  console.orange('  --subject="..."    Email subject. Supports {{appName}} placeholder.');
  console.orange('                     Default: "Bem-vindo(a) ao {{appName}}".');
  console.orange(
    '  --app-url=<url>    URL for the CTA button. Defaults to DOMAIN_CLIENT or APP_URL env.',
  );
  console.orange(
    "  --password=<pwd>   Shared provisional password. Verified against each recipient's",
  );
  console.orange('                     current DB hash — unknown users or mismatches are skipped.');
  console.orange(
    '                     Visible in `ps`/shell history; prefer bare --password in prod.',
  );
  console.orange(
    '  --password         Prompt for the password interactively (not echoed, hidden from ps).',
  );
  console.orange('  --ignore-sent      Resend even to addresses in .sent-welcome-emails.json.');
  console.orange('  --dry-run          Preview recipients without sending anything.');
  console.orange('  --yes / -y         Skip the top-level confirmation prompt.');
  console.orange('  --help / -h        Show this help and exit.');
  console.orange('');
  console.orange('JSON file shape: array of objects with BOTH "name" and "email" fields.');
  console.orange('"name" must not contain CR, LF, or double-quote (rejected at load time).');
  console.orange('  [');
  console.orange('    { "name": "Alice", "email": "alice@example.com" },');
  console.orange('    { "name": "Bob",   "email": "bob@example.com"   }');
  console.orange('  ]');
  console.orange('');
  console.orange(
    `Pacing: ${SEND_INTERVAL_MS}ms between send starts (stays under Resend's 2 req/s cap).`,
  );
  console.orange(
    `Retries: transient failures (429, timeouts, DNS) retried up to ${MAX_ATTEMPTS} times with backoff.`,
  );
  console.orange('Mongo is only connected when --password is set (for hash verification).');
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

function loadRecipients(filePath) {
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

  const seen = new Set();
  const recipients = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    const rawName = typeof item?.name === 'string' ? item.name.trim() : '';
    const rawEmail = typeof item?.email === 'string' ? item.email.trim().toLowerCase() : '';
    if (!rawName) {
      console.red(`Error at index ${i}: missing or empty "name" field.`);
      return null;
    }
    if (INVALID_NAME_CHARS.test(rawName)) {
      console.red(
        `Error at index ${i}: "name" contains invalid characters (CR, LF, or double-quote).`,
      );
      return null;
    }
    if (!rawEmail || !rawEmail.includes('@')) {
      console.red(`Error at index ${i}: missing or invalid "email" field.`);
      return null;
    }
    if (seen.has(rawEmail)) {
      continue;
    }
    seen.add(rawEmail);
    recipients.push({ name: rawName, email: rawEmail });
  }
  return recipients;
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
  console.purple('---------------------------------');
  console.purple('Sending welcome emails (from list)');
  console.purple('---------------------------------');

  const opts = parseArgs(process.argv);

  if (opts.help) {
    printUsage();
    return gracefulExit(0);
  }
  if (!opts.filePath) {
    console.red('Error: --file is required.');
    printUsage();
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

  const appName = process.env.APP_TITLE || 'LabsChat';

  const all = loadRecipients(opts.filePath);
  if (!all) {
    return gracefulExit(1);
  }

  const sentLog = loadSentLog();
  let recipients = opts.ignoreSent
    ? all
    : all.filter((r) => !Object.prototype.hasOwnProperty.call(sentLog, r.email));
  const skippedCount = all.length - recipients.length;

  if (skippedCount > 0) {
    console.orange(
      `Skipping ${skippedCount} recipient(s) previously sent (${path.basename(SENT_LOG_PATH)}). Use --ignore-sent to resend.`,
    );
  }

  if (opts.password && recipients.length > 0) {
    await connect();
    const emails = recipients.map((r) => r.email);
    const dbUsers = await User.find({ email: { $in: emails } })
      .select('+password email')
      .lean();
    const byEmail = new Map(dbUsers.map((u) => [u.email.toLowerCase(), u]));

    const checks = await Promise.all(
      recipients.map(async (r) => {
        const dbUser = byEmail.get(r.email);
        if (!dbUser || !dbUser.password) {
          return { recipient: r, status: 'not_found' };
        }
        const matches = await bcrypt.compare(opts.password, dbUser.password);
        return { recipient: r, status: matches ? 'ok' : 'mismatch' };
      }),
    );

    const notFound = checks.filter((c) => c.status === 'not_found').length;
    const mismatch = checks.filter((c) => c.status === 'mismatch').length;
    if (notFound > 0) {
      console.orange(`Skipping ${notFound} recipient(s) not found in DB.`);
    }
    if (mismatch > 0) {
      console.orange(
        `Skipping ${mismatch} recipient(s) whose current DB password does not match --password.`,
      );
    }
    recipients = checks.filter((c) => c.status === 'ok').map((c) => c.recipient);
  }

  if (recipients.length === 0) {
    console.yellow('Nothing to send — no recipients remain after filters.');
    return gracefulExit(0);
  }

  const estimatedSec = Math.round((recipients.length * SEND_INTERVAL_MS) / 1000);
  console.cyan(
    `Matched ${recipients.length} recipient(s) (~${estimatedSec}s paced at ${SEND_INTERVAL_MS}ms).`,
  );
  if (opts.password) {
    console.orange('Each email will include a provisional password (value redacted).');
  }
  if (opts.dryRun) {
    console.orange('Dry run — no emails will be sent.');
  } else if (!opts.skipConfirm) {
    const confirm = await askQuestion(
      `Send welcome email ("${opts.subject.replace('{{appName}}', appName)}") to ${recipients.length} recipient(s)? (y/N)`,
    );
    if (confirm.toLowerCase() !== 'y') {
      console.yellow('Aborted.');
      return gracefulExit(0);
    }
  }

  const subject = opts.subject.replace('{{appName}}', appName);
  const results = { sent: [], dryRun: [], failed: [] };
  let lastStartAt = 0;

  for (const { name, email } of recipients) {
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
  if (mongoose.connection?.readyState) {
    try {
      await mongoose.disconnect();
    } catch (_e) {
      // best-effort cleanup
    }
  }
  process.exit(1);
});
