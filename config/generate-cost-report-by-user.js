const path = require('path');
const mongoose = require('mongoose');
const { Transaction, User } = require('@librechat/data-schemas').createModels(mongoose);
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { getMultiplier, getCacheMultiplier } = require('../api/models/tx');
const { silentExit } = require('./helpers');
const connect = require('./connect');

const DAYS = Number(process.env.DAYS || 30);
const creditsToUSD = (c) => (Number(c) * 1e-6).toFixed(4);

const printSection = (title) => {
  console.purple('-----------------------------');
  console.purple(title);
  console.purple('-----------------------------');
};

// Recompute cost from the stored raw token counts at CURRENT tx.js rates rather
// than trusting the charged `tokenValue`, which froze any historical mispricing
// (e.g. pre-fix gpt-5.4-mini billed at gpt-5.4 rates). Token counts are stored
// directly (`rawAmount`, or `inputTokens`/`writeTokens`/`readTokens` for cached
// rows), so no knowledge of the old rate is needed.
const costForGroup = ({
  model,
  promptRaw,
  completionRaw,
  inputTokens,
  writeTokens,
  readTokens,
}) => {
  const promptRate = getMultiplier({ model, tokenType: 'prompt' });
  const completionRate = getMultiplier({ model, tokenType: 'completion' });
  const writeRate = getCacheMultiplier({ model, cacheType: 'write' }) ?? promptRate;
  const readRate = getCacheMultiplier({ model, cacheType: 'read' }) ?? promptRate;
  return (
    Math.abs(promptRaw) * promptRate +
    Math.abs(completionRaw) * completionRate +
    Math.abs(inputTokens) * promptRate +
    Math.abs(writeTokens) * writeRate +
    Math.abs(readTokens) * readRate
  );
};

(async () => {
  await connect();

  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

  printSection(
    `Cost Report by User — last ${DAYS} days (since ${since.toISOString().slice(0, 10)})`,
  );

  // Group by (user, model) so the correct per-model rate can be applied; totals
  // are then summed per user for display.
  const pipeline = [
    { $match: { createdAt: { $gte: since }, tokenType: { $in: ['prompt', 'completion'] } } },
    {
      $group: {
        _id: { user: '$user', model: { $ifNull: ['$model', 'unknown'] } },
        promptRaw: {
          $sum: { $cond: [{ $eq: ['$tokenType', 'prompt'] }, { $ifNull: ['$rawAmount', 0] }, 0] },
        },
        completionRaw: {
          $sum: {
            $cond: [{ $eq: ['$tokenType', 'completion'] }, { $ifNull: ['$rawAmount', 0] }, 0],
          },
        },
        inputTokens: { $sum: { $ifNull: ['$inputTokens', 0] } },
        writeTokens: { $sum: { $ifNull: ['$writeTokens', 0] } },
        readTokens: { $sum: { $ifNull: ['$readTokens', 0] } },
        billed: { $sum: { $multiply: [-1, { $ifNull: ['$tokenValue', 0] }] } },
        requests: { $sum: { $cond: [{ $eq: ['$tokenType', 'completion'] }, 1, 0] } },
      },
    },
  ];

  try {
    const [groups, users] = await Promise.all([
      Transaction.aggregate(pipeline).allowDiskUse(true),
      User.find({}, '_id name email').lean(),
    ]);

    if (!groups.length) {
      console.yellow(`No spend transactions found in the last ${DAYS} days.`);
      silentExit(0);
    }

    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const byUser = new Map();
    for (const g of groups) {
      const uid = String(g._id.user);
      if (!byUser.has(uid)) {
        byUser.set(uid, { userId: g._id.user, billed: 0, cost: 0, requests: 0 });
      }
      const entry = byUser.get(uid);
      entry.cost += costForGroup({ model: g._id.model, ...g });
      entry.billed += Number(g.billed || 0);
      entry.requests += Number(g.requests || 0);
    }

    const rows = [...byUser.values()].sort((a, b) => b.cost - a.cost);
    const totalBilled = rows.reduce((s, r) => s + r.billed, 0);
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);

    printSection('Cost by User (billed vs recomputed at current rates)');
    console.table(
      rows.map((r) => {
        const user = userMap.get(String(r.userId));
        return {
          Name: user?.name ?? 'unknown',
          Email: user?.email ?? String(r.userId),
          'Billed $': creditsToUSD(r.billed),
          'Correct $': creditsToUSD(r.cost),
          'Δ $': creditsToUSD(r.billed - r.cost),
          Requests: r.requests,
        };
      }),
    );

    console.purple(
      `\nBilled: $${creditsToUSD(totalBilled)}  |  Correct: $${creditsToUSD(totalCost)}  |  Overcharged: $${creditsToUSD(totalBilled - totalCost)}  (across ${rows.length} users)`,
    );

    silentExit(0);
  } catch (err) {
    console.error('Error generating user cost report:', err);
    process.exit(1);
  }
})();

process.on('uncaughtException', (err) => {
  if (!err.message.includes('fetch failed')) {
    console.error('There was an uncaught error:');
    console.error(err);
  }

  if (!err.message.includes('fetch failed')) {
    process.exit(1);
  }
});
