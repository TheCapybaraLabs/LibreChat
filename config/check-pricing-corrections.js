const path = require('path');
const mongoose = require('mongoose');
const { Transaction } = require('@librechat/data-schemas').createModels(mongoose);
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { silentExit } = require('./helpers');
const connect = require('./connect');

const creditsToUSD = (c) => (Math.abs(Number(c)) * 1e-6).toFixed(6);
const credits = (c) => Number(c || 0).toFixed(0);
const sep = () => console.purple('─'.repeat(60));

// Generic (pre-migration) format carries no model: `pricing-correction-YYYY-MM-DD`.
const GENERIC_CONTEXT = /^pricing-correction-\d{4}-\d{2}-\d{2}$/;

(async () => {
  await connect();

  const txns = await Transaction.find({
    tokenType: 'credits',
    context: { $regex: '^pricing-correction-' },
  })
    .select('user context rawAmount createdAt')
    .sort({ createdAt: 1 })
    .lean();

  if (!txns.length) {
    console.green('No pricing-correction refunds found.');
    silentExit(0);
  }

  console.blue(`Found ${txns.length} pricing-correction refund transaction(s).`);

  // One context value per campaign run.
  const byContext = new Map();
  for (const t of txns) {
    if (!byContext.has(t.context)) {
      byContext.set(t.context, {
        context: t.context,
        generic: GENERIC_CONTEXT.test(t.context),
        count: 0,
        users: new Set(),
        total: 0,
        date: t.createdAt,
      });
    }
    const g = byContext.get(t.context);
    g.count++;
    g.users.add(String(t.user));
    g.total += Number(t.rawAmount || 0);
    if (t.createdAt < g.date) g.date = t.createdAt;
  }

  sep();
  console.purple('Pricing-correction campaigns');
  sep();

  let grandTotal = 0;
  let genericCount = 0;
  const groups = [...byContext.values()].sort((a, b) => a.date - b.date);
  for (const g of groups) {
    grandTotal += g.total;
    if (g.generic) genericCount++;
    (g.generic ? console.orange : console.green)(g.context);
    console.log(`  Format      : ${g.generic ? 'GENERIC (no model)' : 'model-scoped'}`);
    console.log(`  Date        : ${new Date(g.date).toISOString().slice(0, 10)}`);
    console.log(`  Users       : ${g.users.size}`);
    console.log(`  Transactions: ${g.count}`);
    console.log(`  Refunded    : ${credits(g.total)} credits ($${creditsToUSD(g.total)})`);
  }

  sep();
  console.purple(
    `Campaigns     : ${groups.length} (${genericCount} generic / ${groups.length - genericCount} model-scoped)`,
  );
  console.purple(`Total refunded: ${credits(grandTotal)} credits ($${creditsToUSD(grandTotal)})`);
  if (genericCount) {
    console.yellow(
      `\n${genericCount} generic campaign(s) need retagging — run migrate-pricing-correction-context.js --model=<name>`,
    );
  }

  silentExit(0);
})();
