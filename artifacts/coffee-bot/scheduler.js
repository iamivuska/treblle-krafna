const cron = require("node-cron");
const db = require("./db");
const matcher = require("./matcher");
const notifications = require("./notifications");

const DEFAULT_CONFIG = {
  cronExpression: "0 9 1,15 * *",
  description: "1st and 15th of each month at 9am",
};

let activeTask = null;
let followUpTask = null;
let appInstance = null;

async function getSchedulerConfig() {
  try {
    const config = await db.getSchedulerConfig();
    const paused = await db.isSchedulerPaused();
    return {
      ...(config ?? DEFAULT_CONFIG),
      paused,
    };
  } catch (err) {
    console.error(
      "[krafna-bot] getSchedulerConfig: failed to read config from DB, using defaults:",
      err.message ?? err
    );
    return { ...DEFAULT_CONFIG, paused: false };
  }
}

async function setSchedulerConfig(cronExpression, description) {
  try {
    await db.setSchedulerConfig({ cronExpression, description });
  } catch (err) {
    console.error(
      "[krafna-bot] setSchedulerConfig: failed to persist config:",
      err.message ?? err
    );
    throw err;
  }

  if (activeTask) {
    activeTask.stop();
    activeTask = null;
  }
  activeTask = cron.schedule(cronExpression, runMatchingRound, { scheduled: true });
}

async function runMatchingRound() {
  try {
    const paused = await db.isSchedulerPaused();
    if (paused) {
      console.log("[krafna-bot] Scheduler is paused, skipping round.");
      return;
    }

    const users = await matcher.getEligibleUsers();
    if (users.length < 2) {
      console.log(
        `[krafna-bot] Scheduled round skipped: only ${users.length} eligible user(s).`
      );
      return;
    }

    const pairs = await matcher.buildPairs(users);
    if (pairs.length === 0) {
      console.log("[krafna-bot] Scheduled round: could not form any pairs.");
      return;
    }

    const saved = await matcher.saveMatches(pairs);
    const round = await db.incrementRound();
    console.log(
      `[krafna-bot] Scheduled round ${round - 1} complete: ${pairs.length} pair(s) created.`
    );

    await notifications.notifyPairs(appInstance, saved).catch((err) =>
      console.error("[krafna-bot] notifyPairs error:", err.message ?? err)
    );
  } catch (err) {
    console.error("[krafna-bot] Scheduled round failed:", err.message ?? err);
  }
}

async function runFollowUps() {
  if (!appInstance) return;

  let allMatches;
  try {
    allMatches = await db.getMatches("match:");
  } catch (err) {
    console.error(
      "[krafna-bot] runFollowUps: failed to fetch matches from DB:",
      err.message ?? err
    );
    return;
  }

  const now = Date.now();

  for (const match of allMatches) {
    try {
      const ageMs = now - new Date(match.createdAt).getTime();
      const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

      if (ageDays === 3 && match.metAt === null && !match.reminderSentAt) {
        try {
          await notifications.sendReminder(appInstance, match);
        } catch (err) {
          console.error(
            `[krafna-bot] sendReminder error for ${match.matchId}:`,
            err.message ?? err
          );
        }
        try {
          await db.set(match.matchId, { ...match, reminderSentAt: new Date().toISOString() });
        } catch (err) {
          console.error(
            `[krafna-bot] runFollowUps: failed to mark reminderSentAt for ${match.matchId}:`,
            err.message ?? err
          );
        }
      }

      if (ageDays === 7 && !match.feedbackSentAt) {
        try {
          await notifications.sendFeedbackRequest(appInstance, match);
        } catch (err) {
          console.error(
            `[krafna-bot] sendFeedbackRequest error for ${match.matchId}:`,
            err.message ?? err
          );
        }
        try {
          await db.set(match.matchId, { ...match, feedbackSentAt: new Date().toISOString() });
        } catch (err) {
          console.error(
            `[krafna-bot] runFollowUps: failed to mark feedbackSentAt for ${match.matchId}:`,
            err.message ?? err
          );
        }
      }
    } catch (err) {
      console.error(
        `[krafna-bot] runFollowUps: unexpected error processing match ${match.matchId}:`,
        err.message ?? err
      );
    }
  }
}

async function startScheduler(app) {
  appInstance = app;

  const config = await getSchedulerConfig();

  if (activeTask) {
    activeTask.stop();
    activeTask = null;
  }

  try {
    activeTask = cron.schedule(config.cronExpression, runMatchingRound, { scheduled: true });
    const pausedMsg = config.paused ? " (currently paused)" : "";
    console.log(
      `[krafna-bot] Scheduler started: ${config.description} (${config.cronExpression})${pausedMsg}`
    );
  } catch (err) {
    console.error(
      "[krafna-bot] startScheduler: failed to schedule main cron — falling back to default:",
      err.message ?? err
    );
    activeTask = cron.schedule(DEFAULT_CONFIG.cronExpression, runMatchingRound, {
      scheduled: true,
    });
    console.log(
      `[krafna-bot] Scheduler started with default schedule: ${DEFAULT_CONFIG.description}`
    );
  }

  if (followUpTask) {
    followUpTask.stop();
    followUpTask = null;
  }
  followUpTask = cron.schedule("0 9 * * *", runFollowUps, { scheduled: true });
  console.log("[krafna-bot] Follow-up scheduler started: daily at 9am");
}

module.exports = { startScheduler, getSchedulerConfig, setSchedulerConfig };
