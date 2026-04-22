const db = require("./db");

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function getEligibleUsers() {
  const keys = await db.list("user:");
  const users = await Promise.all(keys.map((k) => db.get(k)));
  return users.filter((u) => u && u.optedIn === true);
}

async function buildPairs(users) {
  const lastSatOut = await db.get("meta:lastSatOut");
  const currentRound = await db.getRound();

  const allMatches = await db.getMatches("match:");
  const recentPairSet = new Set();
  for (const match of allMatches) {
    if (typeof match.round === "number" && match.round >= currentRound - 2) {
      const key = [...match.users].sort().join(":");
      recentPairSet.add(key);
    }
  }

  let pool = shuffle(users);
  let satOut = null;

  if (pool.length % 2 !== 0) {
    const sitOutIdx = pool.findIndex((u) => u.userId !== lastSatOut);
    const idx = sitOutIdx !== -1 ? sitOutIdx : 0;
    satOut = pool[idx].userId;
    pool = [...pool.slice(0, idx), ...pool.slice(idx + 1)];
  }

  const paired = new Set();
  const pairs = [];

  for (let i = 0; i < pool.length; i++) {
    if (paired.has(i)) continue;
    const a = pool[i];
    let partnerIdx = -1;

    for (let j = i + 1; j < pool.length; j++) {
      if (paired.has(j)) continue;
      const b = pool[j];
      const key = [a.userId, b.userId].sort().join(":");
      if (!recentPairSet.has(key)) {
        partnerIdx = j;
        break;
      }
    }

    if (partnerIdx === -1) {
      for (let j = i + 1; j < pool.length; j++) {
        if (!paired.has(j)) {
          partnerIdx = j;
          break;
        }
      }
    }

    if (partnerIdx !== -1) {
      pairs.push([a, pool[partnerIdx]]);
      paired.add(i);
      paired.add(partnerIdx);
    }
  }

  if (satOut !== null) {
    await db.set("meta:lastSatOut", satOut);
  }

  return pairs;
}

async function saveMatches(pairs) {
  const round = await db.getRound();
  const now = new Date().toISOString();
  const saved = [];

  for (const [userA, userB] of pairs) {
    const ts = Date.now();
    const matchId = `match:${ts}:${userA.userId}:${userB.userId}`;
    const matchObj = {
      matchId,
      users: [userA.userId, userB.userId],
      createdAt: now,
      metAt: null,
      round,
    };
    await db.set(matchId, matchObj);
    await db.saveUser(userA.userId, { ...userA, lastMatchedAt: now });
    await db.saveUser(userB.userId, { ...userB, lastMatchedAt: now });
    saved.push(matchObj);
  }

  return saved;
}

module.exports = { getEligibleUsers, buildPairs, saveMatches };
