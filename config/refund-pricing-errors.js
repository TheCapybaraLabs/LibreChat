const path = require('path');
const mongoose = require('mongoose');
const { getBalanceConfig } = require('@librechat/api');
const { Transaction, User } = require('@librechat/data-schemas').createModels(mongoose);
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { getValueKey, getMultiplier } = require('../api/models/tx');
const { createTransaction } = require('~/models/Transaction');
const { getAppConfig } = require('~/server/services/Config');
const { silentExit } = require('./helpers');
const connect = require('./connect');

const creditsToUSD = (c) => (Math.abs(Number(c)) * 1e-6).toFixed(6);
const credits = (c) => Number(c || 0).toFixed(0);
const sep = () => console.purple('─'.repeat(60));
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

(async () => {
  await connect();

  let days = 7;
  let minCredits = 1000;
  let dryRun = false;
  let modelFilter = null;

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--days=')) days = Number(arg.slice(7)) || days;
    else if (arg.startsWith('--min=')) minCredits = Number(arg.slice(6)) || minCredits;
    else if (arg.startsWith('--model=')) modelFilter = arg.slice(8) || null;
    else if (arg === '--dry-run') dryRun = true;
  }

  if (dryRun) console.yellow('[DRY RUN] No transactions will be created.');
  console.blue(`Scanning last ${days} days for overcharges ≥ ${minCredits} credits...`);
  if (modelFilter) console.blue(`Filtering to models matching /${modelFilter}/i`);

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const txns = await Transaction.find({
    tokenType: { $in: ['prompt', 'completion'] },
    createdAt: { $gte: since },
    model: modelFilter ? { $regex: modelFilter, $options: 'i' } : { $exists: true, $ne: null },
  })
    .select('user model tokenType valueKey rawAmount tokenValue')
    .lean();

  console.blue(`Found ${txns.length} transactions to analyze`);

  // Sum overcharge per user
  const byUser = new Map();
  for (const txn of txns) {
    if (!txn.model || !txn.rawAmount) continue;
    const expectedKey = getValueKey(txn.model);
    if (expectedKey === txn.valueKey) continue;

    const expectedMultiplier = getMultiplier({ valueKey: expectedKey, tokenType: txn.tokenType });
    const expectedTokenValue = txn.rawAmount * expectedMultiplier;
    const overcharge = Math.abs(txn.tokenValue ?? 0) - Math.abs(expectedTokenValue);
    if (overcharge <= 0) continue;

    const uid = String(txn.user);
    if (!byUser.has(uid)) byUser.set(uid, { userId: txn.user, overcharge: 0 });
    byUser.get(uid).overcharge += overcharge;
  }

  // Filter to users above threshold
  const eligible = [...byUser.values()].filter((e) => e.overcharge >= minCredits);

  if (!eligible.length) {
    console.green(`No users overcharged by ≥ ${minCredits} credits.`);
    silentExit(0);
  }

  const userIds = eligible.map((e) => e.userId);

  // A campaign is identified by what it corrects (the model), not when it ran.
  // Dedupe matches this campaign's prefix exactly and is independent of --days,
  // so prior corrections for other models can't suppress this one and a wider
  // scan window can't pull in unrelated refunds.
  const campaign = modelFilter ? modelFilter : 'all';
  const contextPrefix = `pricing-correction-${campaign}`;
  const reason = `${contextPrefix}-${new Date().toISOString().slice(0, 10)}`;

  // Skip users already refunded for THIS correction campaign (any prior run).
  const existingRefunds = await Transaction.find({
    user: { $in: userIds },
    tokenType: 'credits',
    context: { $regex: `^${escapeRegex(contextPrefix)}-` },
  })
    .select('user')
    .lean();
  const alreadyRefunded = new Set(existingRefunds.map((t) => String(t.user)));

  if (alreadyRefunded.size) {
    console.yellow(`Skipping ${alreadyRefunded.size} user(s) already refunded for "${campaign}".`);
  }

  const toRefund = eligible.filter((e) => !alreadyRefunded.has(String(e.userId)));
  if (!toRefund.length) {
    console.green('All eligible users have already been refunded.');
    silentExit(0);
  }

  const users = await User.find({ _id: { $in: toRefund.map((e) => e.userId) } })
    .select('_id email')
    .lean();
  const userMap = new Map(users.map((u) => [String(u._id), u.email]));

  const appConfig = await getAppConfig();
  const balanceConfig = getBalanceConfig(appConfig);

  if (!balanceConfig?.enabled) {
    console.red('Error: Balance is not enabled.');
    silentExit(1);
  }

  sep();
  const sorted = toRefund.sort((a, b) => b.overcharge - a.overcharge);
  let grandTotal = 0;
  let successCount = 0;

  for (const entry of sorted) {
    const email = userMap.get(String(entry.userId)) ?? '(unknown)';
    const refundAmount = Math.ceil(entry.overcharge);
    grandTotal += refundAmount;

    console.orange(`${email}`);
    console.log(
      `  Overcharge : ${credits(entry.overcharge)} credits ($${creditsToUSD(entry.overcharge)})`,
    );
    console.log(`  Refunding  : ${refundAmount} credits`);

    if (dryRun) {
      console.yellow('  [DRY RUN] Skipped.');
      successCount++;
      continue;
    }

    try {
      const result = await createTransaction({
        user: entry.userId,
        tokenType: 'credits',
        context: reason,
        rawAmount: refundAmount,
        balance: balanceConfig,
      });
      console.green(`  New balance: ${result?.balance ?? '(unknown)'}`);
      successCount++;
    } catch (err) {
      console.red(`  Error: ${err.message}`);
    }
  }

  sep();
  if (dryRun) console.yellow('[DRY RUN] No transactions were created.');
  console.purple(`Processed   : ${successCount}/${sorted.length} users`);
  console.purple(`Total refund : ${credits(grandTotal)} credits ($${creditsToUSD(grandTotal)})`);

  silentExit(0);
})();
