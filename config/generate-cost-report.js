const path = require("path");
const mongoose = require("mongoose");
const { Transaction, Balance, User } =
	require("@librechat/data-schemas").createModels(mongoose);
require("module-alias")({ base: path.resolve(__dirname, "..", "api") });
const { silentExit } = require("./helpers");
const connect = require("./connect");

const DAYS = Number(process.env.DAYS || 30);
const creditsToUSD = (c) => (Number(c) * 1e-6).toFixed(4);
const fmt = (n, d = 0) => Number(n || 0).toFixed(d);

function printSection(title) {
	console.purple("-----------------------------");
	console.purple(title);
	console.purple("-----------------------------");
}

(async () => {
	await connect();

	const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

	printSection(
		`Cost & Credit Report — last ${DAYS} days (since ${since.toISOString().slice(0, 10)})`,
	);

	const modelPipeline = [
		{
			$match: {
				createdAt: { $gte: since },
				tokenType: { $in: ["prompt", "completion"] },
			},
		},
		{
			$group: {
				_id: { model: { $ifNull: ["$model", "unknown"] } },
				totalTokenValue: { $sum: { $ifNull: ["$tokenValue", 0] } },
				totalInputTokens: { $sum: { $ifNull: ["$inputTokens", 0] } },
				totalWriteTokens: { $sum: { $ifNull: ["$writeTokens", 0] } },
				totalReadTokens: { $sum: { $ifNull: ["$readTokens", 0] } },
				requests: { $sum: 1 },
			},
		},
		{
			$project: {
				_id: 0,
				model: "$_id.model",
				cost: { $multiply: [-1, "$totalTokenValue"] },
				totalInputTokens: { $multiply: [-1, "$totalInputTokens"] },
				totalWriteTokens: { $multiply: [-1, "$totalWriteTokens"] },
				totalReadTokens: { $multiply: [-1, "$totalReadTokens"] },
				requests: 1,
			},
		},
		{ $sort: { cost: -1 } },
	];

	const dailyPipeline = [
		{
			$match: {
				createdAt: { $gte: since },
				tokenType: { $in: ["prompt", "completion"] },
			},
		},
		{
			$group: {
				_id: {
					y: { $year: "$createdAt" },
					m: { $month: "$createdAt" },
					d: { $dayOfMonth: "$createdAt" },
				},
				totalTokenValue: { $sum: { $ifNull: ["$tokenValue", 0] } },
				requests: { $sum: 1 },
			},
		},
		{
			$project: {
				_id: 0,
				date: {
					$dateFromParts: { year: "$_id.y", month: "$_id.m", day: "$_id.d" },
				},
				cost: { $multiply: [-1, "$totalTokenValue"] },
				requests: 1,
			},
		},
		{ $sort: { date: 1 } },
	];

	const creditsPipeline = [
		{ $match: { createdAt: { $gte: since }, tokenType: "credits" } },
		{
			$group: {
				_id: null,
				totalAdded: { $sum: { $ifNull: ["$tokenValue", 0] } },
				count: { $sum: 1 },
			},
		},
	];

	const balancePipeline = [
		{
			$group: {
				_id: null,
				total: { $sum: "$tokenCredits" },
				users: { $sum: 1 },
			},
		},
	];

	try {
		const [
			modelResults,
			dailyResults,
			creditResults,
			balanceResults,
			totalUsers,
		] = await Promise.all([
			Transaction.aggregate(modelPipeline).allowDiskUse(true),
			Transaction.aggregate(dailyPipeline).allowDiskUse(true),
			Transaction.aggregate(creditsPipeline).allowDiskUse(true),
			Balance.aggregate(balancePipeline),
			User.countDocuments(),
		]);

		if (!modelResults.length) {
			console.yellow(`No spend transactions found in the last ${DAYS} days.`);
			silentExit(0);
		}

		const totalSpent = modelResults.reduce(
			(s, r) => s + Number(r.cost || 0),
			0,
		);
		const totalRequests = modelResults.reduce(
			(s, r) => s + Number(r.requests || 0),
			0,
		);
		const creditsAdded = Number(creditResults[0]?.totalAdded || 0);
		const currentBalance = Number(balanceResults[0]?.total || 0);
		const usersWithBalance = Number(balanceResults[0]?.users || 0);
		const dailyAvg = dailyResults.length ? totalSpent / dailyResults.length : 0;
		const daysLeft = dailyAvg > 0 ? currentBalance / dailyAvg : Infinity;
		const depletionDate = Number.isFinite(daysLeft)
			? new Date(Date.now() + daysLeft * 24 * 60 * 60 * 1000)
					.toISOString()
					.slice(0, 10)
			: "N/A";

		// ── Summary ──────────────────────────────────────────────────────────────
		printSection("Summary");
		console.table([
			{ Metric: "Period", Value: `${DAYS} days` },
			{ Metric: "Total requests", Value: totalRequests.toLocaleString() },
			{ Metric: "Total spent (credits)", Value: fmt(totalSpent) },
			{ Metric: "Total spent (USD)", Value: `$${creditsToUSD(totalSpent)}` },
			{ Metric: "Daily avg (credits)", Value: fmt(dailyAvg) },
			{ Metric: "Daily avg (USD)", Value: `$${creditsToUSD(dailyAvg)}` },
			{ Metric: "Credits added", Value: fmt(creditsAdded) },
			{ Metric: "Current balance (credits)", Value: fmt(currentBalance) },
			{
				Metric: "Current balance (USD)",
				Value: `$${creditsToUSD(currentBalance)}`,
			},
			{
				Metric: "Users with balance",
				Value: `${usersWithBalance} / ${totalUsers}`,
			},
			{
				Metric: "Est. days remaining",
				Value: Number.isFinite(daysLeft) ? fmt(daysLeft) : "N/A",
			},
			{ Metric: "Est. depletion date", Value: depletionDate },
		]);

		// ── Per-model table ───────────────────────────────────────────────────────
		printSection("Cost by AI Model");
		console.table(
			modelResults.map((r) => ({
				Model: r.model,
				Credits: fmt(r.cost),
				USD: `$${creditsToUSD(r.cost)}`,
				"% of Total": `${totalSpent > 0 ? ((Number(r.cost) / totalSpent) * 100).toFixed(1) : "0.0"}%`,
				Requests: Number(r.requests || 0),
				"Input Tokens": Number(fmt(r.totalInputTokens)),
				"Write Tokens": Number(fmt(r.totalWriteTokens)),
				"Read Tokens": Number(fmt(r.totalReadTokens)),
			})),
		);

		// ── Daily breakdown ───────────────────────────────────────────────────────
		printSection("Daily Spend");
		console.table(
			dailyResults.map((d) => ({
				Date: new Date(d.date).toISOString().slice(0, 10),
				Credits: fmt(d.cost),
				USD: `$${creditsToUSD(d.cost)}`,
				Requests: Number(d.requests || 0),
			})),
		);

		silentExit(0);
	} catch (err) {
		console.error("Error generating cost report:", err);
		process.exit(1);
	}
})();

process.on("uncaughtException", (err) => {
	if (!err.message.includes("fetch failed")) {
		console.error("There was an uncaught error:");
		console.error(err);
	}

	if (!err.message.includes("fetch failed")) {
		process.exit(1);
	}
});
