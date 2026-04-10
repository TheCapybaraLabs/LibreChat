const path = require('path');
const mongoose = require('mongoose');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { silentExit } = require('./helpers');
const { Session, User } = require('@librechat/data-schemas').createModels(mongoose);
const connect = require('./connect');

(async () => {
  await connect();

  console.purple('-----------------------------');
  console.purple('Currently logged-in users');
  console.purple('-----------------------------');

  const now = new Date();

  const activeSessions = await Session.aggregate([
    { $match: { expiration: { $gt: now } } },
    { $group: { _id: '$user', sessionCount: { $sum: 1 }, latestExpiry: { $max: '$expiration' } } },
  ]);

  if (activeSessions.length === 0) {
    console.orange('No active sessions found.');
    silentExit(0);
  }

  const userIds = activeSessions.map((s) => s._id);
  const users = await User.find({ _id: { $in: userIds } }, 'name email').lean();
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  const rows = activeSessions.map((s) => {
    const user = userMap.get(s._id.toString()) ?? {};
    return {
      Name: user.name ?? '(unknown)',
      Email: user.email ?? '(unknown)',
      Sessions: s.sessionCount,
      'Latest Expiry': s.latestExpiry.toISOString(),
    };
  });

  rows.sort((a, b) => b.Sessions - a.Sessions);

  console.log(`\nTotal unique users with active sessions: ${rows.length}`);
  console.table(rows);

  silentExit(0);
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
