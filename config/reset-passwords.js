#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { User } = require('@librechat/data-schemas').createModels(mongoose);
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { askQuestion, silentExit } = require('./helpers');
const connect = require('./connect');

async function gracefulExit(code = 0) {
  try {
    await mongoose.disconnect();
  } catch (err) {
    console.error('Error disconnecting from MongoDB:', err);
  }
  silentExit(code);
}

function printUsage() {
  console.orange('Usage: node config/reset-passwords.js (--all | --file=<file.json>) [options]');
  console.orange('');
  console.orange('Options:');
  console.orange('  --all                        Target every user in the DB');
  console.orange('  --file=<path>                JSON array of emails (strings or {email})');
  console.orange('  --new-password=<pwd>         New password (prompted if omitted)');
  console.orange(
    '  --match-current=<pwd>        Only reset users whose current password matches this',
  );
  console.orange('  --dry-run                    Do not mutate; print what would change');
  console.orange('  --yes, -y                    Skip confirmation prompt');
  console.orange('');
  console.orange('Examples:');
  console.orange('  # Reset every matching user from a shared classroom password');
  console.orange(
    '  node config/reset-passwords.js --all --match-current=Temp1234! --new-password=NewPass1234!',
  );
  console.orange('');
  console.orange('  # Reset only the listed users, regardless of current password');
  console.orange('  node config/reset-passwords.js --file=class.json --new-password=NewPass1234!');
}

(async () => {
  await connect();

  console.purple('---------------------------------');
  console.purple('Bulk password reset');
  console.purple('---------------------------------');

  let filePath;
  let targetAll = false;
  let newPassword;
  let matchCurrent;
  let dryRun = false;
  let skipConfirm = false;

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--all') {
      targetAll = true;
      continue;
    }
    if (arg.startsWith('--file=')) {
      filePath = arg.slice('--file='.length);
      continue;
    }
    if (arg.startsWith('--new-password=')) {
      newPassword = arg.slice('--new-password='.length);
      continue;
    }
    if (arg.startsWith('--match-current=')) {
      matchCurrent = arg.slice('--match-current='.length);
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--yes' || arg === '-y') {
      skipConfirm = true;
      continue;
    }
    console.red(`Unknown argument: ${arg}`);
    printUsage();
    return gracefulExit(1);
  }

  if (!targetAll && !filePath) {
    printUsage();
    return gracefulExit(1);
  }
  if (targetAll && filePath) {
    console.red('Error: --all and --file are mutually exclusive.');
    return gracefulExit(1);
  }

  let allowlist;
  if (filePath) {
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      console.red('Error: File not found: ' + resolvedPath);
      return gracefulExit(1);
    }
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    } catch (err) {
      console.red('Error: Failed to parse JSON: ' + err.message);
      return gracefulExit(1);
    }
    if (!Array.isArray(raw) || raw.length === 0) {
      console.red('Error: JSON must be a non-empty array.');
      return gracefulExit(1);
    }
    allowlist = new Set();
    for (let i = 0; i < raw.length; i++) {
      const item = raw[i];
      const rawEmail = typeof item === 'string' ? item : item?.email;
      const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
      if (!email || !email.includes('@')) {
        console.red(`Invalid email at index ${i}: ${JSON.stringify(item)}`);
        return gracefulExit(1);
      }
      allowlist.add(email);
    }
  }

  if (!dryRun) {
    if (!newPassword) {
      newPassword = await askQuestion('Enter NEW password for target users: ');
      if (!newPassword || newPassword.length < 8) {
        console.red('Password must be at least 8 characters.');
        return gracefulExit(1);
      }
      const confirm = await askQuestion('Confirm NEW password: ');
      if (confirm !== newPassword) {
        console.red('Passwords do not match.');
        return gracefulExit(1);
      }
    } else if (newPassword.length < 8) {
      console.red('--new-password must be at least 8 characters.');
      return gracefulExit(1);
    }
  }

  const query = { password: { $exists: true, $ne: null } };
  if (allowlist) {
    query.email = { $in: Array.from(allowlist) };
  }
  const users = await User.find(query).select('+password email').lean();

  if (users.length === 0) {
    console.orange('No users matched the query.');
    return gracefulExit(0);
  }

  console.cyan(`Candidates: ${users.length}`);
  if (matchCurrent) {
    console.cyan(`Will only reset users whose current password matches the provided value.`);
  }

  if (targetAll && !matchCurrent && !dryRun) {
    console.red('WARNING: --all without --match-current resets EVERY local-auth user.');
    const typed = await askQuestion('Type "ALL" to confirm unconditional reset:');
    if (typed !== 'ALL') {
      console.yellow('Aborted.');
      return gracefulExit(0);
    }
  } else if (dryRun) {
    console.orange('Dry run — no passwords will be changed.');
  } else if (!skipConfirm) {
    const confirm = await askQuestion(`Reset password for up to ${users.length} user(s)? (y/N)`);
    if (confirm.toLowerCase() !== 'y') {
      console.yellow('Aborted.');
      return gracefulExit(0);
    }
  }

  let newHash;
  if (!dryRun) {
    const salt = await bcrypt.genSalt(10);
    newHash = await bcrypt.hash(newPassword, salt);
  }

  const results = { reset: [], skipped: [], failed: [] };
  const BATCH = 16;

  async function processUser(user) {
    const email = user.email;
    try {
      if (matchCurrent) {
        const matches = await bcrypt.compare(matchCurrent, user.password);
        if (!matches) {
          results.skipped.push(email);
          return;
        }
      }

      if (dryRun) {
        console.cyan(`  [dry-run] ${email}`);
        results.reset.push(email);
        return;
      }

      await User.updateOne({ _id: user._id }, { password: newHash, passwordVersion: Date.now() });
      console.green(`  [ok] ${email}`);
      results.reset.push(email);
    } catch (err) {
      console.red(`  [fail] ${email} — ${err.message}`);
      results.failed.push({ email, reason: err.message });
    }
  }

  for (let i = 0; i < users.length; i += BATCH) {
    const batch = users.slice(i, i + BATCH);
    await Promise.all(batch.map(processUser));
    const processed = Math.min(i + BATCH, users.length);
    console.gray(
      `  ... ${processed}/${users.length} (matched: ${results.reset.length}, skipped: ${results.skipped.length})`,
    );
  }

  console.purple('---------------------------------');
  if (dryRun) {
    console.cyan(`Would reset: ${results.reset.length}`);
  } else {
    console.green(`Reset      : ${results.reset.length}`);
  }
  console.orange(`Skipped    : ${results.skipped.length}`);
  console.red(`Failed     : ${results.failed.length}`);
  for (const f of results.failed) {
    console.red(`  ${f.email}: ${f.reason}`);
  }
  console.purple('---------------------------------');

  return gracefulExit(results.failed.length > 0 ? 1 : 0);
})().catch(async (err) => {
  console.error('Fatal error:', err);
  await gracefulExit(1);
});
