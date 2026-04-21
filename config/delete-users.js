#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const {
  Key,
  User,
  File,
  Agent,
  Token,
  Group,
  Action,
  Preset,
  Prompt,
  Balance,
  Message,
  Session,
  AclEntry,
  ToolCall,
  Assistant,
  MCPServer,
  SharedLink,
  PluginAuth,
  MemoryEntry,
  PromptGroup,
  AgentApiKey,
  Transaction,
  Conversation,
  ConversationTag,
} = require('@librechat/data-schemas').createModels(mongoose);
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

async function deleteUserCascade(user, deleteTx) {
  const uid = user._id.toString();

  const tasks = [
    Action.deleteMany({ user: uid }),
    Agent.deleteMany({ author: uid }),
    AgentApiKey.deleteMany({ user: uid }),
    Assistant.deleteMany({ user: uid }),
    Balance.deleteMany({ user: uid }),
    ConversationTag.deleteMany({ user: uid }),
    Conversation.deleteMany({ user: uid }),
    Message.deleteMany({ user: uid }),
    File.deleteMany({ user: uid }),
    Key.deleteMany({ userId: uid }),
    MCPServer.deleteMany({ author: uid }),
    MemoryEntry.deleteMany({ userId: uid }),
    PluginAuth.deleteMany({ userId: uid }),
    Prompt.deleteMany({ author: uid }),
    PromptGroup.deleteMany({ author: uid }),
    Preset.deleteMany({ user: uid }),
    Session.deleteMany({ user: uid }),
    SharedLink.deleteMany({ user: uid }),
    ToolCall.deleteMany({ user: uid }),
    Token.deleteMany({ userId: uid }),
    AclEntry.deleteMany({ principalId: user._id }),
  ];

  if (deleteTx) {
    tasks.push(Transaction.deleteMany({ user: uid }));
  }

  await Promise.all(tasks);
  await Group.updateMany({ memberIds: user._id }, { $pull: { memberIds: user._id } });
  await User.deleteOne({ _id: uid });
}

(async () => {
  await connect();

  console.purple('---------------------------------');
  console.purple('Bulk user deletion from JSON file');
  console.purple('---------------------------------');

  let filePath;
  let dryRun = false;
  let skipConfirm = false;
  let globalDeleteTx = false;

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--file=')) {
      filePath = arg.slice('--file='.length);
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
    if (arg === '--delete-transactions') {
      globalDeleteTx = true;
      continue;
    }
    if (!filePath && !arg.startsWith('--')) {
      filePath = arg;
    }
  }

  if (!filePath) {
    console.orange(
      'Usage: node config/delete-users.js <file.json> [--delete-transactions] [--dry-run] [--yes]',
    );
    console.orange('');
    console.orange('JSON format (either form is accepted):');
    console.orange('  ["a@example.com", "b@example.com"]');
    console.orange('  or');
    console.orange('  [');
    console.orange('    { "email": "a@example.com" },');
    console.orange('    { "email": "b@example.com", "deleteTransactions": true }');
    console.orange('  ]');
    console.orange('');
    console.orange(
      'Per-user "deleteTransactions" overrides the global --delete-transactions flag.',
    );
    console.orange('Transaction history is retained by default.');
    return gracefulExit(1);
  }

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

  const entries = [];
  const validationErrors = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    const rawEmail = typeof item === 'string' ? item : item?.email;
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!email || !email.includes('@')) {
      validationErrors.push(`[${i}] Invalid or missing email: ${JSON.stringify(item)}`);
      continue;
    }
    const deleteTx =
      typeof item === 'object' && item !== null && typeof item.deleteTransactions === 'boolean'
        ? item.deleteTransactions
        : globalDeleteTx;
    entries.push({ email, deleteTx });
  }

  if (validationErrors.length > 0) {
    console.red('Validation errors:');
    for (const err of validationErrors) {
      console.red('  ' + err);
    }
    return gracefulExit(1);
  }

  if (dryRun) {
    console.orange('Dry run — no users will be deleted.');
  } else if (!skipConfirm) {
    const confirm = await askQuestion(
      `Really delete ${entries.length} user(s) and ALL their data? (y/N)`,
    );
    if (confirm.toLowerCase() !== 'y') {
      console.yellow('Aborted.');
      return gracefulExit(0);
    }
  }

  const results = { deleted: [], notFound: [], dryRun: [], failed: [] };

  for (const entry of entries) {
    const { email, deleteTx } = entry;
    const user = await User.findOne({ email });
    if (!user) {
      console.orange(`  [skip] ${email} — not found`);
      results.notFound.push(email);
      continue;
    }

    if (dryRun) {
      console.cyan(`  [dry-run] ${email} (${user._id}) — deleteTransactions: ${deleteTx}`);
      results.dryRun.push(email);
      continue;
    }

    try {
      await deleteUserCascade(user, deleteTx);
      console.green(`  [ok] ${email}${deleteTx ? ' (tx deleted)' : ''}`);
      results.deleted.push(email);
    } catch (err) {
      console.red(`  [fail] ${email} — ${err.message}`);
      results.failed.push({ email, reason: err.message });
    }
  }

  console.purple('---------------------------------');
  if (dryRun) {
    console.cyan(`Dry-run  : ${results.dryRun.length}`);
  } else {
    console.green(`Deleted  : ${results.deleted.length}`);
  }
  console.orange(`Not found: ${results.notFound.length}`);
  if (!dryRun) {
    console.red(`Failed   : ${results.failed.length}`);
    for (const f of results.failed) {
      console.red(`  ${f.email}: ${f.reason}`);
    }
  }
  console.purple('---------------------------------');

  return gracefulExit(results.failed.length > 0 ? 1 : 0);
})().catch(async (err) => {
  if (!err.message.includes('fetch failed')) {
    console.error('There was an uncaught error:');
    console.error(err);
    await mongoose.disconnect();
    process.exit(1);
  }
});
