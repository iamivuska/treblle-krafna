const db = require("./db");
const scheduler = require("./scheduler");

async function getStats() {
  const allUserKeys = await db.list("user:");
  const allUsers = await Promise.all(allUserKeys.map((k) => db.get(k)));
  const optedInUsers = allUsers.filter((u) => u && u.optedIn);

  const allMatches = await db.getMatches("match:");
  const totalPairs = allMatches.length;
  const confirmedMeetings = allMatches.filter((m) => m.metAt !== null).length;
  const confirmationRate =
    totalPairs === 0 ? 0 : Math.round((confirmedMeetings / totalPairs) * 100);

  const matchCounts = {};
  for (const match of allMatches) {
    for (const userId of match.users || []) {
      matchCounts[userId] = (matchCounts[userId] || 0) + 1;
    }
  }
  const mostActive = Object.entries(matchCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([userId, count]) => ({ userId, count }));

  const roundValue = await db.getRound();
  const totalRounds = Math.max(0, roundValue - 1);

  const schedConfig = await scheduler.getSchedulerConfig();

  return {
    totalOptedInUsers: optedInUsers.length,
    totalRounds,
    totalPairs,
    confirmedMeetings,
    confirmationRate,
    mostActive,
    scheduler: {
      paused: schedConfig.paused,
      description: schedConfig.description,
      cronExpression: schedConfig.cronExpression,
    },
  };
}

module.exports = { getStats };
