const path = require('path');
const mongoose = require('mongoose');
const { Transaction, User } = require('@librechat/data-schemas').createModels(mongoose);
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { silentExit } = require('./helpers');

const printSection = (title) => {
  console.purple('-----------------------------');
  console.purple(title);
  console.purple('-----------------------------');
};
const connect = require('./connect');

const DAYS = Number(process.env.DAYS || 30);
const creditsToUSD = (c) => (Number(c) * 1e-6).toFixed(4);
const fmt = (n, d = 0) => Number(n || 0).toFixed(d);

(async () => {
  await connect();

  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

  printSection(
    `Cost Report by User & Model — last ${DAYS} days (since ${since.toISOString().slice(0, 10)})`,
  );

  // ── Per-user + per-model breakdown ─────────────────────────────────────────
  const byUserModelPipeline = [
    { $match: { createdAt: { $gte: since }, tokenType: { $in: ['prompt', 'completion'] } } },
    {
      $group: {
        _id: {
          user: '$user',
          model: { $ifNull: ['$model', 'unknown'] },
        },
        totalTokenValue: { $sum: { $ifNull: ['$tokenValue', 0] } },
        totalInputTokens: { $sum: { $ifNull: ['$inputTokens', 0] } },
        totalWriteTokens: { $sum: { $ifNull: ['$writeTokens', 0] } },
        totalReadTokens: { $sum: { $ifNull: ['$readTokens', 0] } },
        requests: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        userId: '$_id.user',
        model: '$_id.model',
        cost: { $multiply: [-1, '$totalTokenValue'] },
        totalInputTokens: { $multiply: [-1, '$totalInputTokens'] },
        totalWriteTokens: { $multiply: [-1, '$totalWriteTokens'] },
        totalReadTokens: { $multiply: [-1, '$totalReadTokens'] },
        requests: 1,
      },
    },
    { $sort: { cost: -1 } },
  ];

  // ── Per-user totals ─────────────────────────────────────────────────────────
  const byUserPipeline = [
    { $match: { createdAt: { $gte: since }, tokenType: { $in: ['prompt', 'completion'] } } },
    {
      $group: {
        _id: '$user',
        totalTokenValue: { $sum: { $ifNull: ['$tokenValue', 0] } },
        requests: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        userId: '$_id',
        cost: { $multiply: [-1, '$totalTokenValue'] },
        requests: 1,
      },
    },
    { $sort: { cost: -1 } },
  ];

  try {
    const [byUserModel, byUser, users] = await Promise.all([
      Transaction.aggregate(byUserModelPipeline).allowDiskUse(true),
      Transaction.aggregate(byUserPipeline).allowDiskUse(true),
      User.find({}, '_id name email').lean(),
    ]);

    if (!byUserModel.length) {
      console.yellow(`No spend transactions found in the last ${DAYS} days.`);
      silentExit(0);
    }

    const userMap = new Map(users.map((u) => [String(u._id), u]));
    const totalSpent = byUser.reduce((s, r) => s + Number(r.cost || 0), 0);

    // ── Per-user summary ──────────────────────────────────────────────────────
    printSection('Cost by User');
    console.table(
      byUser.map((r) => {
        const user = userMap.get(String(r.userId));
        return {
          Name: user?.name ?? 'unknown',
          Email: user?.email ?? String(r.userId),
          Credits: fmt(r.cost),
          USD: `$${creditsToUSD(r.cost)}`,
          '% of Total': `${totalSpent > 0 ? ((Number(r.cost) / totalSpent) * 100).toFixed(1) : '0.0'}%`,
          Requests: Number(r.requests || 0),
        };
      }),
    );

    // ── Per-user + per-model detail ───────────────────────────────────────────
    printSection('Cost by User & Model');
    console.table(
      byUserModel.map((r) => {
        const user = userMap.get(String(r.userId));
        return {
          Name: user?.name ?? 'unknown',
          Email: user?.email ?? String(r.userId),
          Model: r.model,
          Credits: fmt(r.cost),
          USD: `$${creditsToUSD(r.cost)}`,
          '% of Total': `${totalSpent > 0 ? ((Number(r.cost) / totalSpent) * 100).toFixed(1) : '0.0'}%`,
          Requests: Number(r.requests || 0),
          'Input Tokens': Number(fmt(r.totalInputTokens)),
          'Write Tokens': Number(fmt(r.totalWriteTokens)),
          'Read Tokens': Number(fmt(r.totalReadTokens)),
        };
      }),
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
