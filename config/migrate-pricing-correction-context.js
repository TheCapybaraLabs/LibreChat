const path = require('path');
const mongoose = require('mongoose');
const { Transaction } = require('@librechat/data-schemas').createModels(mongoose);
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { silentExit } = require('./helpers');
const connect = require('./connect');

const sep = () => console.purple('─'.repeat(60));

// Old generic refund context: `pricing-correction-YYYY-MM-DD` (no model).
// New format inserts the model: `pricing-correction-<model>-YYYY-MM-DD`.
const PREFIX = 'pricing-correction-';
const GENERIC_CONTEXT = /^pricing-correction-\d{4}-\d{2}-\d{2}$/;

(async () => {
  await connect();

  let model = null;
  let dryRun = false;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--model=')) model = arg.slice(8) || null;
    else if (arg === '--dry-run') dryRun = true;
  }

  if (!model) {
    console.red('Error: --model=<name> is required (the model the old generic refunds were for).');
    silentExit(1);
  }

  if (dryRun) console.yellow('[DRY RUN] No documents will be modified.');
  console.blue(`Retagging generic refunds → "${PREFIX}${model}-<date>"`);

  const txns = await Transaction.find({
    tokenType: 'credits',
    context: GENERIC_CONTEXT,
  })
    .select('context createdAt')
    .sort({ createdAt: 1 })
    .lean();

  if (!txns.length) {
    console.green('No generic-format pricing-correction transactions found.');
    silentExit(0);
  }

  console.blue(`Found ${txns.length} transaction(s) to retag.`);
  sep();

  const sample = txns.slice(0, 10);
  for (const t of sample) {
    console.log(`  ${t.context}  →  ${t.context.replace(PREFIX, `${PREFIX}${model}-`)}`);
  }
  if (txns.length > sample.length) {
    console.gray(`  … and ${txns.length - sample.length} more`);
  }
  sep();

  if (dryRun) {
    console.yellow('[DRY RUN] No documents were modified.');
    silentExit(0);
  }

  const result = await Transaction.updateMany({ tokenType: 'credits', context: GENERIC_CONTEXT }, [
    {
      $set: {
        context: {
          $replaceOne: { input: '$context', find: PREFIX, replacement: `${PREFIX}${model}-` },
        },
      },
    },
  ]);

  console.green(`Updated ${result.modifiedCount} transaction(s).`);
  silentExit(0);
})();
