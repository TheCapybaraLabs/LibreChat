const path = require('path');
const mongoose = require('mongoose');
const { Transaction, User } = require('@librechat/data-schemas').createModels(mongoose);
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { getValueKey, getMultiplier } = require('../api/models/tx');
const { silentExit } = require('./helpers');
const connect = require('./connect');

const creditsToUSD = (c) => (Math.abs(Number(c)) * 1e-6).toFixed(6);
const credits = (c) => Number(c || 0).toFixed(0);
const sep = () => console.purple('─'.repeat(60));
const printSection = (title) => {
  sep();
  console.purple(title);
  sep();
};

(async () => {
  await connect();

  let days = 7;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--days=')) days = Number(arg.slice(7)) || days;
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  console.blue(`Checking transactions since ${since.toISOString()} (last ${days} days)...`);

  const txns = await Transaction.find({
    tokenType: { $in: ['prompt', 'completion'] },
    createdAt: { $gte: since },
    model: { $exists: true, $ne: null },
  })
    .select('user model tokenType valueKey rawAmount tokenValue createdAt conversationId')
    .lean();

  console.blue(`Found ${txns.length} transactions to analyze`);

  if (!txns.length) {
    console.green('No transactions found.');
    silentExit(0);
  }

  const mismatches = [];
  for (const txn of txns) {
    if (!txn.model || !txn.rawAmount) continue;
    const expectedKey = getValueKey(txn.model);
    if (expectedKey === txn.valueKey) continue;

    const expectedMultiplier = getMultiplier({ valueKey: expectedKey, tokenType: txn.tokenType });
    const expectedTokenValue = txn.rawAmount * expectedMultiplier;
    // positive = overcharged (was charged more than current pricing says)
    const overcharge = Math.abs(txn.tokenValue ?? 0) - Math.abs(expectedTokenValue);
    mismatches.push({ ...txn, expectedKey, expectedTokenValue, overcharge });
  }

  if (!mismatches.length) {
    console.green('No pricing mismatches found.');
    silentExit(0);
  }

  console.red(`Found ${mismatches.length} mismatched transactions!`);

  // Group by (model, storedKey, expectedKey)
  const byModel = new Map();
  for (const txn of mismatches) {
    const key = `${txn.model}|${txn.valueKey ?? 'undefined'}|${txn.expectedKey ?? 'undefined'}`;
    if (!byModel.has(key)) {
      byModel.set(key, {
        model: txn.model,
        storedKey: txn.valueKey,
        expectedKey: txn.expectedKey,
        count: 0,
        totalOvercharge: 0,
      });
    }
    const entry = byModel.get(key);
    entry.count++;
    entry.totalOvercharge += txn.overcharge;
  }

  printSection('Pricing Mismatches by Model');
  for (const [, entry] of byModel) {
    const direction = entry.totalOvercharge > 0 ? console.red : console.green;
    direction(`Model: ${entry.model}`);
    console.log(`  Stored key  : ${entry.storedKey ?? '(none — used defaultRate)'}`);
    console.log(`  Expected key: ${entry.expectedKey ?? '(none — no match)'}`);
    console.log(`  Transactions: ${entry.count}`);
    const label = entry.totalOvercharge > 0 ? 'Overcharged' : 'Undercharged';
    console.log(
      `  ${label}   : ${credits(Math.abs(entry.totalOvercharge))} credits ($${creditsToUSD(entry.totalOvercharge)})`,
    );
  }

  // Group by user
  const byUser = new Map();
  for (const txn of mismatches) {
    const uid = String(txn.user);
    if (!byUser.has(uid)) byUser.set(uid, { userId: txn.user, count: 0, totalOvercharge: 0 });
    const entry = byUser.get(uid);
    entry.count++;
    entry.totalOvercharge += txn.overcharge;
  }

  const userIds = [...byUser.keys()].map((id) => new mongoose.Types.ObjectId(id));
  const users = await User.find({ _id: { $in: userIds } })
    .select('_id email')
    .lean();
  const userMap = new Map(users.map((u) => [String(u._id), u.email]));

  const sorted = [...byUser.values()].sort((a, b) => b.totalOvercharge - a.totalOvercharge);

  printSection('Affected Users');
  let grandTotal = 0;
  for (const entry of sorted) {
    const email = userMap.get(String(entry.userId)) ?? '(unknown)';
    grandTotal += entry.totalOvercharge;
    const printer = entry.totalOvercharge > 0 ? console.orange : console.green;
    printer(email);
    console.log(`  Transactions: ${entry.count}`);
    const label = entry.totalOvercharge > 0 ? 'Overcharged' : 'Undercharged';
    console.log(
      `  ${label}   : ${credits(Math.abs(entry.totalOvercharge))} credits ($${creditsToUSD(entry.totalOvercharge)})`,
    );
  }

  sep();
  const totalLabel = grandTotal > 0 ? 'Total overcharge' : 'Total undercharge';
  console.red(
    `${totalLabel}: ${credits(Math.abs(grandTotal))} credits ($${creditsToUSD(grandTotal)})`,
  );
  console.log(`Affected users: ${sorted.length}`);

  silentExit(0);
})();
