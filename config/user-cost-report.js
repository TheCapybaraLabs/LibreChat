const path = require('path');
const mongoose = require('mongoose');
const { Transaction, User, Conversation } =
  require('@librechat/data-schemas').createModels(mongoose);
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { getValueKey, getMultiplier } = require('../api/models/tx');
const { silentExit } = require('./helpers');
const connect = require('./connect');

/** Re-compute cost using current pricing if valueKey has changed. */
const correctedCost = (txn) => {
  const expectedKey = getValueKey(txn.model);
  if (expectedKey === txn.valueKey || !txn.rawAmount) return Math.abs(txn.tokenValue ?? 0);
  return Math.abs(
    txn.rawAmount * getMultiplier({ valueKey: expectedKey, tokenType: txn.tokenType }),
  );
};

const creditsToUSD = (c) => (Number(c) * 1e-6).toFixed(4);
const credits = (c) => Number(c || 0).toFixed(0);
const sep = () => console.purple('-----------------------------');
const printSection = (title) => {
  sep();
  console.purple(title);
  sep();
};

(async () => {
  await connect();

  const email = process.argv[2];
  if (!email || email.startsWith('--') || !email.includes('@')) {
    console.orange('Usage: node config/user-cost-report.js <email> [--days=30] [--top=5]');
    silentExit(1);
  }

  let days = Number(process.env.DAYS || 30);
  let topConvos = Number(process.env.TOP_CONVOS || 5);
  for (let i = 3; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--days=')) {
      days = Number(arg.slice('--days='.length)) || days;
    } else if (arg.startsWith('--top=')) {
      topConvos = Number(arg.slice('--top='.length)) || topConvos;
    }
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const user = await User.findOne({ email: email.trim().toLowerCase() }, '_id name email').lean();
  if (!user) {
    console.red('Error: No user found with email: ' + email);
    silentExit(1);
  }

  printSection(`Cost Report — ${user.name} <${user.email}> — last ${days} days`);

  const txns = await Transaction.find({
    user: user._id,
    createdAt: { $gte: since },
    tokenType: { $in: ['prompt', 'completion'] },
  })
    .select(
      'model tokenType valueKey rawAmount tokenValue inputTokens writeTokens readTokens conversationId createdAt',
    )
    .lean();

  if (!txns.length) {
    console.yellow(`No transactions found for this user in the last ${days} days.`);
    silentExit(0);
  }

  // Aggregate in JS so correctedCost() can fix any stale valueKey entries
  let totalCost = 0,
    totalInputTokens = 0,
    totalWriteTokens = 0,
    totalReadTokens = 0;
  const modelMap = new Map();
  const convoMap = new Map();

  for (const txn of txns) {
    const cost = correctedCost(txn);
    totalCost += cost;
    totalInputTokens += Math.abs(txn.inputTokens ?? 0);
    totalWriteTokens += Math.abs(txn.writeTokens ?? 0);
    totalReadTokens += Math.abs(txn.readTokens ?? 0);

    const modelKey = txn.model ?? 'unknown';
    const m = modelMap.get(modelKey) ?? { cost: 0, requests: 0 };
    m.cost += cost;
    m.requests++;
    modelMap.set(modelKey, m);

    if (txn.conversationId) {
      const c = convoMap.get(txn.conversationId) ?? {
        cost: 0,
        requests: 0,
        lastActivity: txn.createdAt,
      };
      c.cost += cost;
      c.requests++;
      if (txn.createdAt > c.lastActivity) c.lastActivity = txn.createdAt;
      convoMap.set(txn.conversationId, c);
    }
  }

  const byModel = [...modelMap.entries()]
    .map(([model, v]) => ({ _id: model, ...v }))
    .sort((a, b) => b.cost - a.cost);

  const byConvo = [...convoMap.entries()]
    .map(([id, v]) => ({ _id: id, ...v }))
    .sort((a, b) => b.cost - a.cost);

  printSection('Summary');
  console.green(`  Credits   : ${credits(totalCost)}`);
  console.green(`  USD       : $${creditsToUSD(totalCost)}`);
  console.white(`  Requests  : ${txns.length}`);
  console.white(`  Input Tok : ${Math.round(totalInputTokens)}`);
  console.white(`  Write Tok : ${Math.round(totalWriteTokens)}`);
  console.white(`  Read Tok  : ${Math.round(totalReadTokens)}`);

  if (byModel.length) {
    printSection('Cost by Model');
    console.table(
      byModel.map((r) => ({
        Model: r._id,
        Credits: credits(r.cost),
        USD: `$${creditsToUSD(r.cost)}`,
        Requests: r.requests,
      })),
    );
  }

  if (!byConvo.length) {
    console.yellow('No conversation-linked transactions found.');
    silentExit(0);
  }

  const allConvoIds = byConvo.map((r) => r._id);
  const convos = await Conversation.find(
    { conversationId: { $in: allConvoIds } },
    'conversationId title',
  ).lean();
  const titleMap = new Map(convos.map((c) => [c.conversationId, c.title ?? '(no title)']));

  const enriched = byConvo.map((r) => ({
    title: titleMap.get(r._id) ?? '(no title)',
    cost: r.cost,
    requests: r.requests,
    lastActivity: r.lastActivity,
  }));

  printSection('Most Expensive Conversation');
  const top = enriched[0];
  console.table([
    {
      Title: top.title,
      Credits: credits(top.cost),
      USD: `$${creditsToUSD(top.cost)}`,
      Requests: top.requests,
      'Last Activity': top.lastActivity.toISOString().slice(0, 16).replace('T', ' '),
    },
  ]);

  const recent = [...enriched].sort((a, b) => b.lastActivity - a.lastActivity).slice(0, topConvos);

  printSection(`Last ${topConvos} Conversations by Activity`);
  console.table(
    recent.map((r) => ({
      Title: r.title,
      Credits: credits(r.cost),
      USD: `$${creditsToUSD(r.cost)}`,
      Requests: r.requests,
      'Last Activity': r.lastActivity.toISOString().slice(0, 16).replace('T', ' '),
    })),
  );

  sep();
  silentExit(0);
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
