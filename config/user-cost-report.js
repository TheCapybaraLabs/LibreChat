const path = require("path");
const mongoose = require("mongoose");
const { Transaction, User, Conversation } =
	require("@librechat/data-schemas").createModels(mongoose);
require("module-alias")({ base: path.resolve(__dirname, "..", "api") });
const { silentExit } = require("./helpers");
const connect = require("./connect");

const creditsToUSD = (c) => (Number(c) * 1e-6).toFixed(4);
const credits = (c) => Number(c || 0).toFixed(0);
const sep = () => console.purple("-----------------------------");
const printSection = (title) => {
	sep();
	console.purple(title);
	sep();
};

(async () => {
	await connect();

	const email = process.argv[2];
	if (!email || email.startsWith("--") || !email.includes("@")) {
		console.orange(
			"Usage: node config/user-cost-report.js <email> [--days=30] [--top=5]",
		);
		silentExit(1);
	}

	let days = Number(process.env.DAYS || 30);
	let topConvos = Number(process.env.TOP_CONVOS || 5);
	for (let i = 3; i < process.argv.length; i++) {
		const arg = process.argv[i];
		if (arg.startsWith("--days=")) {
			days = Number(arg.slice("--days=".length)) || days;
		} else if (arg.startsWith("--top=")) {
			topConvos = Number(arg.slice("--top=".length)) || topConvos;
		}
	}

	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

	const user = await User.findOne(
		{ email: email.trim().toLowerCase() },
		"_id name email",
	).lean();
	if (!user) {
		console.red("Error: No user found with email: " + email);
		silentExit(1);
	}

	printSection(
		`Cost Report — ${user.name} <${user.email}> — last ${days} days`,
	);

	const matchBase = {
		user: user._id,
		createdAt: { $gte: since },
		tokenType: { $in: ["prompt", "completion"] },
	};

	const [totalResult, byModel, byConvo] = await Promise.all([
		Transaction.aggregate([
			{ $match: matchBase },
			{
				$group: {
					_id: null,
					cost: { $sum: { $multiply: [-1, { $ifNull: ["$tokenValue", 0] }] } },
					requests: { $sum: 1 },
					inputTokens: {
						$sum: { $multiply: [-1, { $ifNull: ["$inputTokens", 0] }] },
					},
					writeTokens: {
						$sum: { $multiply: [-1, { $ifNull: ["$writeTokens", 0] }] },
					},
					readTokens: {
						$sum: { $multiply: [-1, { $ifNull: ["$readTokens", 0] }] },
					},
				},
			},
		]).allowDiskUse(true),

		Transaction.aggregate([
			{ $match: matchBase },
			{
				$group: {
					_id: { $ifNull: ["$model", "unknown"] },
					cost: { $sum: { $multiply: [-1, { $ifNull: ["$tokenValue", 0] }] } },
					requests: { $sum: 1 },
				},
			},
			{ $sort: { cost: -1 } },
		]).allowDiskUse(true),

		Transaction.aggregate([
			{
				$match: { ...matchBase, conversationId: { $exists: true, $ne: null } },
			},
			{
				$group: {
					_id: "$conversationId",
					cost: { $sum: { $multiply: [-1, { $ifNull: ["$tokenValue", 0] }] } },
					requests: { $sum: 1 },
					lastActivity: { $max: "$createdAt" },
				},
			},
			{ $sort: { cost: -1 } },
		]).allowDiskUse(true),
	]);

	const total = totalResult[0];
	if (!total || total.requests === 0) {
		console.yellow(
			`No transactions found for this user in the last ${days} days.`,
		);
		silentExit(0);
	}

	printSection("Summary");
	console.green(`  Credits   : ${credits(total.cost)}`);
	console.green(`  USD       : $${creditsToUSD(total.cost)}`);
	console.white(`  Requests  : ${total.requests}`);
	console.white(`  Input Tok : ${Math.round(total.inputTokens || 0)}`);
	console.white(`  Write Tok : ${Math.round(total.writeTokens || 0)}`);
	console.white(`  Read Tok  : ${Math.round(total.readTokens || 0)}`);

	if (byModel.length) {
		printSection("Cost by Model");
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
		console.yellow("No conversation-linked transactions found.");
		silentExit(0);
	}

	const allConvoIds = byConvo.map((r) => r._id);
	const convos = await Conversation.find(
		{ conversationId: { $in: allConvoIds } },
		"conversationId title",
	).lean();
	const titleMap = new Map(
		convos.map((c) => [c.conversationId, c.title ?? "(no title)"]),
	);

	const enriched = byConvo.map((r) => ({
		title: titleMap.get(r._id) ?? "(no title)",
		cost: r.cost,
		requests: r.requests,
		lastActivity: r.lastActivity,
	}));

	printSection("Most Expensive Conversation");
	const top = enriched[0];
	console.table([
		{
			Title: top.title,
			Credits: credits(top.cost),
			USD: `$${creditsToUSD(top.cost)}`,
			Requests: top.requests,
			"Last Activity": top.lastActivity
				.toISOString()
				.slice(0, 16)
				.replace("T", " "),
		},
	]);

	const recent = [...enriched]
		.sort((a, b) => b.lastActivity - a.lastActivity)
		.slice(0, topConvos);

	printSection(`Last ${topConvos} Conversations by Activity`);
	console.table(
		recent.map((r) => ({
			Title: r.title,
			Credits: credits(r.cost),
			USD: `$${creditsToUSD(r.cost)}`,
			Requests: r.requests,
			"Last Activity": r.lastActivity
				.toISOString()
				.slice(0, 16)
				.replace("T", " "),
		})),
	);

	sep();
	silentExit(0);
})();

process.on("uncaughtException", (err) => {
	if (!err.message.includes("fetch failed")) {
		console.error("There was an uncaught error:");
		console.error(err);
	}

	if (err.message.includes("fetch failed")) {
		return;
	} else {
		process.exit(1);
	}
});
