#!/usr/bin/env node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
const path = require('path');
const mongoose = require('mongoose');
const { Keyv } = require('keyv');
const { keyvMongo, isEnabled } = require('@librechat/api');
const { ViolationTypes } = require('librechat-data-provider');
const { User } = require('@librechat/data-schemas').createModels(mongoose);
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { askQuestion, silentExit } = require('./helpers');
const { getLogStores } = require('~/cache');
const connect = require('./connect');

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
    email: null,
    ip: null,
    all: false,
    list: false,
    violations: null,
    dryRun: false,
    skipConfirm: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--email=')) {
      opts.email = arg.slice('--email='.length).trim().toLowerCase();
      continue;
    }
    if (arg.startsWith('--ip=')) {
      opts.ip = arg.slice('--ip='.length).trim();
      continue;
    }
    if (arg.startsWith('--violations=')) {
      opts.violations = arg.slice('--violations='.length).trim().toLowerCase();
      continue;
    }
    if (arg === '--all') {
      opts.all = true;
      continue;
    }
    if (arg === '--list') {
      opts.list = true;
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
    'Usage: node config/clear-ban.js [--list] [--violations=<addr>] [--email=<addr>] [--ip=<addr>] [--all] [--dry-run] [--yes]',
  );
  console.orange('');
  console.orange('Inspect or clear ban state (banLogs + banCache from checkBan.js).');
  console.orange('');
  console.orange('  --list             List all currently banned entries (userIds and IPs).');
  console.orange('  --violations=<addr> Show recent violation history for this user email.');
  console.orange(
    '  --email=<addr>     Unban the user with this email (+ any IP bans they caused).',
  );
  console.orange('  --ip=<addr>        Unban this IP address.');
  console.orange('  --all              Wipe every ban entry (destructive; prompts unless --yes).');
  console.orange('  --dry-run          Show what would be cleared without writing.');
  console.orange('  --yes / -y         Skip the confirmation prompt for --all.');
}

function banCacheKey(kind, id) {
  if (isEnabled(process.env.USE_REDIS)) {
    return `ban_cache:${kind}:${id}`;
  }
  return id;
}

async function resolveUserId(email) {
  if (!email) {
    return null;
  }
  const user = await User.findOne({ email }).select('_id').lean();
  return user ? user._id.toString() : null;
}

async function clearOneEntry({ kind, id, banLogs, banCache, label, dryRun }) {
  const logKey = id;
  const cacheKey = banCacheKey(kind, id);
  const logHit = await banLogs.get(logKey);
  const cacheHit = await banCache.get(cacheKey);
  const found = Boolean(logHit || cacheHit);

  if (dryRun) {
    console.cyan(`  [dry-run] ${label} — log=${!!logHit} cache=${!!cacheHit}`);
    return found;
  }

  if (logHit) {
    await banLogs.delete(logKey);
  }
  if (cacheHit) {
    await banCache.delete(cacheKey);
  }

  if (found) {
    console.green(`  [cleared] ${label}`);
  } else {
    console.orange(`  [skip] ${label} — no ban entry found`);
  }
  return found;
}

async function findIpBansCausedBy(userId) {
  const entries = await fetchKeyvEntries(BAN_LOG_NAMESPACE);
  return entries.filter(
    (e) => looksLikeIp(e.key) && String(e.value?.user_id ?? '') === String(userId),
  );
}

const BAN_LOG_NAMESPACE = 'BANS';
const BAN_CACHE_NAMESPACE = 'ban';
const KEYV_COLLECTION = 'logs';

function parseKeyvValue(rawValue) {
  if (rawValue == null) {
    return null;
  }
  try {
    const outer = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    return outer && typeof outer === 'object' && 'value' in outer ? outer.value : outer;
  } catch (_err) {
    return null;
  }
}

function looksLikeIp(key) {
  if (typeof key !== 'string') {
    return false;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(key)) {
    return true;
  }
  return key.includes(':') && /^[0-9a-f:]+$/i.test(key);
}

async function fetchKeyvEntries(namespace) {
  const collection = mongoose.connection.db.collection(KEYV_COLLECTION);
  const prefix = `${namespace}:`;
  const docs = await collection
    .find({ key: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } })
    .toArray();

  return docs.map((doc) => ({
    rawKey: doc.key,
    key: typeof doc.key === 'string' ? doc.key.slice(prefix.length) : doc.key,
    value: parseKeyvValue(doc.value),
    expiresAt: doc.expiresAt instanceof Date ? doc.expiresAt.getTime() : null,
  }));
}

async function resolveEmails(userIds) {
  const unique = [...new Set(userIds.filter(Boolean).map(String))];
  if (unique.length === 0) {
    return new Map();
  }
  const validIds = unique.filter((id) => mongoose.isValidObjectId(id));
  if (validIds.length === 0) {
    return new Map();
  }
  const users = await User.find({ _id: { $in: validIds } })
    .select('_id email')
    .lean();
  return new Map(users.map((u) => [u._id.toString(), u.email]));
}

function describeRemaining(remaining) {
  if (remaining == null) {
    return 'no expiry';
  }
  if (remaining <= 0) {
    return 'EXPIRED (stale doc)';
  }
  return `expires in ${Math.round(remaining / 60000)}m`;
}

function formatExpiry(entry) {
  const appExpiresAt = entry.value?.expiresAt ?? null;
  const docExpiresAt = entry.expiresAt ?? null;
  const remaining = appExpiresAt ? appExpiresAt - Date.now() : null;
  const status = describeRemaining(remaining);
  const docHint =
    docExpiresAt && Math.abs(docExpiresAt - (appExpiresAt ?? 0)) > 60_000
      ? ` (doc TTL until ${new Date(docExpiresAt).toISOString()})`
      : '';
  return { status, docHint };
}

async function showViolations(email) {
  const userId = await resolveUserId(email);
  if (!userId) {
    console.red(`No user found for email "${email}".`);
    return;
  }
  const generalLogs = getLogStores(ViolationTypes.GENERAL);
  const entries = (await generalLogs.get(userId)) ?? [];
  if (entries.length === 0) {
    console.yellow(`No violations recorded for ${email} (${userId}).`);
    return;
  }

  const grouped = new Map();
  for (const entry of entries) {
    const type = entry?.type ?? 'unknown';
    grouped.set(type, (grouped.get(type) ?? 0) + 1);
  }

  console.purple(`Violations for ${email} (${userId}) — total ${entries.length}:`);
  for (const [type, count] of grouped.entries()) {
    console.cyan(`  ${type}: ${count}`);
  }

  const recent = entries.slice(-10);
  console.purple(`Most recent ${recent.length}:`);
  for (const entry of recent) {
    const date = entry?.date ?? 'unknown date';
    const vc = entry?.violation_count ?? '?';
    const extra = entry?.max != null ? ` max=${entry.max}` : '';
    console.cyan(`  ${date}  type=${entry?.type ?? '?'}  count=${vc}${extra}`);
  }
}

async function listBans() {
  const [logEntries, cacheEntries] = await Promise.all([
    fetchKeyvEntries(BAN_LOG_NAMESPACE),
    fetchKeyvEntries(BAN_CACHE_NAMESPACE),
  ]);

  const ipEntries = [];
  const userEntries = [];
  for (const entry of logEntries) {
    (looksLikeIp(entry.key) ? ipEntries : userEntries).push(entry);
  }

  const userIds = [
    ...userEntries.map((e) => e.key),
    ...ipEntries.map((e) => e.value?.user_id).filter(Boolean),
  ];
  const emails = await resolveEmails(userIds);

  const fmtIp = (entry) => {
    const { status, docHint } = formatExpiry(entry);
    const user_id = entry.value?.user_id;
    const email = user_id ? emails.get(String(user_id)) : null;
    const who = email ? `${email} (${user_id})` : user_id || 'unknown user';
    return `  ${entry.key} — ${status} (caused by ${who})${docHint}`;
  };

  const fmtUser = (entry) => {
    const { status, docHint } = formatExpiry(entry);
    const email = emails.get(String(entry.key));
    const label = email ? `${email} (${entry.key})` : entry.key;
    return `  ${label} — ${status}${docHint}`;
  };

  console.purple(`IP bans (${ipEntries.length}):`);
  if (ipEntries.length === 0) {
    console.yellow('  (none)');
  } else {
    ipEntries.forEach((e) => console.cyan(fmtIp(e)));
  }
  console.purple(`User bans (${userEntries.length}):`);
  if (userEntries.length === 0) {
    console.yellow('  (none)');
  } else {
    userEntries.forEach((e) => console.cyan(fmtUser(e)));
  }

  if (cacheEntries.length > 0) {
    console.purple(`banCache entries (${cacheEntries.length}) — runtime decision cache:`);
    cacheEntries.forEach((e) => console.cyan(`  ${e.key}`));
  }
}

(async () => {
  await connect();

  console.purple('---------------------');
  console.purple('Ban administration');
  console.purple('---------------------');

  const opts = parseArgs(process.argv);

  const hasAction = opts.list || opts.email || opts.ip || opts.all || opts.violations;
  if (!hasAction) {
    printUsage();
    return gracefulExit(1);
  }

  if (opts.email && !opts.email.includes('@')) {
    console.red('Error: Invalid email address.');
    return gracefulExit(1);
  }
  if (opts.violations && !opts.violations.includes('@')) {
    console.red('Error: --violations requires a valid email address.');
    return gracefulExit(1);
  }

  if (!isEnabled(process.env.BAN_VIOLATIONS)) {
    console.yellow(
      'Warning: BAN_VIOLATIONS is not enabled — checkBan is a no-op at runtime, but this script will still clear any stale entries.',
    );
  }

  const banLogs = getLogStores(ViolationTypes.BAN);
  const banCache = new Keyv({ store: keyvMongo, namespace: ViolationTypes.BAN, ttl: 0 });

  if (opts.list) {
    await listBans();
    return gracefulExit(0);
  }

  if (opts.violations) {
    await showViolations(opts.violations);
    return gracefulExit(0);
  }

  if (opts.all) {
    const [logEntries, cacheEntries] = await Promise.all([
      fetchKeyvEntries(BAN_LOG_NAMESPACE),
      fetchKeyvEntries(BAN_CACHE_NAMESPACE),
    ]);
    const total = logEntries.length + cacheEntries.length;

    if (opts.dryRun) {
      console.cyan(
        `[dry-run] would wipe ${logEntries.length} banLogs entries and ${cacheEntries.length} banCache entries (${total} total)`,
      );
      return gracefulExit(0);
    }
    if (total === 0) {
      console.yellow('No ban entries to clear.');
      return gracefulExit(0);
    }
    if (!opts.skipConfirm) {
      const confirm = await askQuestion(
        `Really clear ALL ${total} ban entries (every user and every IP)? (y/N)`,
      );
      if (confirm.toLowerCase() !== 'y') {
        console.yellow('Aborted.');
        return gracefulExit(0);
      }
    }
    await banLogs.clear();
    await banCache.clear();
    console.green(`Cleared ${total} ban entries.`);
    return gracefulExit(0);
  }

  const subjects = [];
  if (opts.email) {
    const userId = await resolveUserId(opts.email);
    if (!userId) {
      console.orange(`No user found for email "${opts.email}".`);
    } else {
      subjects.push({ kind: 'user', id: userId, label: `user ${opts.email} (${userId})` });
      const cascadedIps = await findIpBansCausedBy(userId);
      if (cascadedIps.length > 0) {
        console.cyan(
          `Also clearing ${cascadedIps.length} IP ban(s) caused by this user (classroom cascade).`,
        );
        for (const ipEntry of cascadedIps) {
          subjects.push({
            kind: 'ip',
            id: ipEntry.key,
            label: `ip ${ipEntry.key} (caused by ${opts.email})`,
          });
        }
      }
    }
  }
  if (opts.ip) {
    subjects.push({ kind: 'ip', id: opts.ip, label: `ip ${opts.ip}` });
  }

  if (subjects.length === 0) {
    console.red('Nothing to clear.');
    return gracefulExit(1);
  }

  if (opts.dryRun) {
    console.orange('Dry run — no writes will be performed.');
  }

  let foundAny = false;
  for (const subject of subjects) {
    const found = await clearOneEntry({
      ...subject,
      banLogs,
      banCache,
      dryRun: opts.dryRun,
    });
    foundAny = foundAny || found;
  }

  console.purple('---------------------');
  if (opts.dryRun) {
    console.cyan('Dry run complete.');
  } else if (foundAny) {
    console.green('Done.');
  } else {
    console.yellow('No matching ban entries were found.');
  }

  return gracefulExit(0);
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
