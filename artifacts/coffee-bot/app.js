require("dotenv").config();

const REQUIRED_ENV_VARS = [
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "SLACK_APP_TOKEN",
];

for (const varName of REQUIRED_ENV_VARS) {
  if (!process.env[varName]) {
    console.error(`[krafna-bot] Missing required environment variable: ${varName}`);
    process.exit(1);
  }
}

const { App } = require("@slack/bolt");
const db = require("./db");
const matcher = require("./matcher");
const scheduler = require("./scheduler");
const notifications = require("./notifications");
const reports = require("./reports");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// ─── Error helpers ────────────────────────────────────────────────────────────

const GENERIC_ERROR_BLOCKS = {
  blocks: [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "⚠️ Something went wrong on our end. Please try again in a moment.",
      },
    },
  ],
  text: "⚠️ Something went wrong. Please try again in a moment.",
};

async function safeRespond(respond, err, label) {
  console.error(`[krafna-bot] ${label}:`, err);
  try {
    await respond(GENERIC_ERROR_BLOCKS);
  } catch (respondErr) {
    console.error("[krafna-bot] Failed to send error response:", respondErr);
  }
}

// ─── Block builders ───────────────────────────────────────────────────────────

function buildHomeView(user) {
  if (!user || !user.optedIn) {
    return {
      type: "home",
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "🍩 Krafna Chat" },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "You are *not* opted in to krafna chats.",
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Join krafna chats" },
              style: "primary",
              action_id: "krafna_join",
            },
          ],
        },
      ],
    };
  }

  const joinedDate = new Date(user.joinedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    type: "home",
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🍩 Krafna Chat" },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `You are *opted in* to krafna chats.\n*Joined:* ${joinedDate}`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Leave krafna chats" },
            style: "danger",
            action_id: "krafna_leave",
            confirm: {
              title: { type: "plain_text", text: "Leave krafna chats?" },
              text: {
                type: "mrkdwn",
                text: "You will no longer be matched for krafna chats.",
              },
              confirm: { type: "plain_text", text: "Leave" },
              deny: { type: "plain_text", text: "Cancel" },
            },
          },
        ],
      },
    ],
  };
}

function getAdminUserIds() {
  return (process.env.ADMIN_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function isAdmin(userId) {
  const admins = getAdminUserIds();
  return admins.length === 0 || admins.includes(userId);
}

function buildEnhancedUserHomeBlocks(userId, user, allMatches, schedConfig) {
  const blocks = [];

  blocks.push({ type: "header", text: { type: "plain_text", text: "🍩 Krafna Chat", emoji: true } });

  if (!user || !user.optedIn) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "You are *not* opted in to krafna chats." },
    });
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Join krafna chats", emoji: true },
          style: "primary",
          action_id: "krafna_join",
        },
      ],
    });
  } else {
    const joinedDate = new Date(user.joinedAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `✅ You are *opted in* to krafna chats.\n*Joined:* ${joinedDate}` },
    });
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Leave krafna chats", emoji: true },
          style: "danger",
          action_id: "krafna_leave",
          confirm: {
            title: { type: "plain_text", text: "Leave krafna chats?" },
            text: { type: "mrkdwn", text: "You will no longer be matched for krafna chats." },
            confirm: { type: "plain_text", text: "Leave" },
            deny: { type: "plain_text", text: "Cancel" },
          },
        },
      ],
    });
  }

  blocks.push({ type: "divider" });

  const userMatches = allMatches
    .filter((m) => m.users && m.users.includes(userId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 10);

  if (userMatches.length > 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "*Your match history:*" } });
    for (const match of userMatches) {
      const partner = match.users[0] === userId ? match.users[1] : match.users[0];
      const matchDate = new Date(match.createdAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const metIcon = match.metAt ? "✅" : "❌";
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `${metIcon}  <@${partner}> — ${matchDate}` },
      });
    }
  } else {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No matches yet — you'll be matched in the next round!_" },
    });
  }

  blocks.push({ type: "divider" });

  const schedIcon = schedConfig.paused ? "⏸️" : "📅";
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `${schedIcon} *Next scheduled round:* ${schedConfig.description}`,
    },
  });

  return blocks;
}

function buildAdminHomeBlocks(stats, allMatches) {
  const blocks = [];

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: "🍩 Krafna Admin Dashboard", emoji: true },
  });

  blocks.push({
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*Opted-in users:*\n${stats.totalOptedInUsers}` },
      { type: "mrkdwn", text: `*Rounds run:*\n${stats.totalRounds}` },
      { type: "mrkdwn", text: `*Total pairs:*\n${stats.totalPairs}` },
      {
        type: "mrkdwn",
        text: `*Meetings confirmed:*\n${stats.confirmedMeetings} (${stats.confirmationRate}%)`,
      },
    ],
  });

  if (stats.mostActive.length > 0) {
    const activeList = stats.mostActive.map((u) => `<@${u.userId}> (${u.count})`).join("  ·  ");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Most active:* ${activeList}` },
    });
  }

  blocks.push({ type: "divider" });

  const statusIcon = stats.scheduler.paused ? "⏸️ Paused" : "▶️ Active";
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text:
        `*Scheduler:* ${statusIcon}\n` +
        `*Schedule:* ${stats.scheduler.description}\n` +
        `*Cron:* \`${stats.scheduler.cronExpression}\``,
    },
  });

  const pauseResumeButton = stats.scheduler.paused
    ? {
        type: "button",
        text: { type: "plain_text", text: "▶️ Resume", emoji: true },
        style: "primary",
        action_id: "krafna_admin_resume",
      }
    : {
        type: "button",
        text: { type: "plain_text", text: "⏸️ Pause", emoji: true },
        action_id: "krafna_admin_pause",
      };

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "▶️ Run Now", emoji: true },
        style: "primary",
        action_id: "krafna_admin_run",
        confirm: {
          title: { type: "plain_text", text: "Run a matching round now?" },
          text: {
            type: "mrkdwn",
            text: "This will match all opted-in users and send DMs immediately.",
          },
          confirm: { type: "plain_text", text: "Run" },
          deny: { type: "plain_text", text: "Cancel" },
        },
      },
      pauseResumeButton,
    ],
  });

  blocks.push({ type: "divider" });

  const maxRound = allMatches.length > 0 ? Math.max(...allMatches.map((m) => m.round ?? 0)) : 0;
  if (maxRound === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*Match History*\n_No rounds have been run yet._" },
    });
  } else {
    const minRound = Math.max(1, maxRound - 2);
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Match History* — rounds ${minRound}–${maxRound}` },
    });
    for (let r = maxRound; r >= minRound; r--) {
      const roundMatches = allMatches.filter((m) => m.round === r);
      if (roundMatches.length === 0) continue;
      const roundDate = new Date(roundMatches[0].createdAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*Round ${r}* — ${roundDate}` },
      });
      for (const match of roundMatches.slice(0, 5)) {
        const icon = match.metAt ? "✅" : "❌";
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `${icon}  <@${match.users[0]}> ↔ <@${match.users[1]}>` },
        });
      }
    }
  }

  return blocks;
}

async function publishHomeView(userId) {
  try {
    let blocks;
    if (isAdmin(userId)) {
      const stats = await reports.getStats();
      const allMatches = await db.getMatches("match:");
      blocks = buildAdminHomeBlocks(stats, allMatches);
    } else {
      const user = await db.getUser(userId);
      const allMatches = await db.getMatches("match:");
      const schedConfig = await scheduler.getSchedulerConfig();
      blocks = buildEnhancedUserHomeBlocks(userId, user, allMatches, schedConfig);
    }
    await app.client.views.publish({
      user_id: userId,
      view: { type: "home", blocks },
    });
  } catch (err) {
    console.error(`[krafna-bot] publishHomeView failed for ${userId}:`, err);
    try {
      await app.client.views.publish({
        user_id: userId,
        view: {
          type: "home",
          blocks: [
            { type: "header", text: { type: "plain_text", text: "🍩 Krafna Chat", emoji: true } },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "⚠️ Couldn't load your dashboard right now. Please try refreshing in a moment.",
              },
            },
          ],
        },
      });
    } catch (fallbackErr) {
      console.error("[krafna-bot] Could not publish fallback home view:", fallbackErr);
    }
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────

app.event("app_home_opened", async ({ event }) => {
  try {
    await publishHomeView(event.user);
  } catch (err) {
    console.error("[krafna-bot] app_home_opened unhandled error:", err);
  }
});

// ─── Actions ─────────────────────────────────────────────────────────────────

app.action("krafna_join", async ({ body, ack }) => {
  await ack();
  const userId = body.user.id;
  try {
    const existing = await db.getUser(userId);
    if (existing) {
      await db.saveUser(userId, { ...existing, optedIn: true });
    } else {
      await db.saveUser(userId, {
        userId,
        displayName: body.user.name || "",
        timezone: null,
        teamId: body.user.team_id || null,
        optedIn: true,
        joinedAt: new Date().toISOString(),
        lastMatchedAt: null,
      });
    }
    await publishHomeView(userId);
  } catch (err) {
    console.error("[krafna-bot] krafna_join action failed:", err);
    await publishHomeView(userId);
  }
});

app.action("krafna_leave", async ({ body, ack }) => {
  await ack();
  const userId = body.user.id;
  try {
    const existing = await db.getUser(userId);
    if (existing) {
      await db.saveUser(userId, { ...existing, optedIn: false });
    }
    await publishHomeView(userId);
  } catch (err) {
    console.error("[krafna-bot] krafna_leave action failed:", err);
    await publishHomeView(userId);
  }
});

app.action("krafna_admin_run", async ({ body, ack }) => {
  await ack();
  const userId = body.user.id;
  try {
    const users = await matcher.getEligibleUsers();
    if (users.length >= 2) {
      const pairs = await matcher.buildPairs(users);
      if (pairs.length > 0) {
        const saved = await matcher.saveMatches(pairs);
        await db.incrementRound();
        await notifications.notifyPairs(app, saved).catch((err) =>
          console.error("[krafna-bot] notifyPairs error:", err)
        );
      }
    }
  } catch (err) {
    console.error("[krafna-bot] krafna_admin_run action failed:", err);
  }
  await publishHomeView(userId);
});

app.action("krafna_admin_pause", async ({ body, ack }) => {
  await ack();
  const userId = body.user.id;
  try {
    await db.setSchedulerPaused(true);
  } catch (err) {
    console.error("[krafna-bot] krafna_admin_pause action failed:", err);
  }
  await publishHomeView(userId);
});

app.action("krafna_admin_resume", async ({ body, ack }) => {
  await ack();
  const userId = body.user.id;
  try {
    await db.setSchedulerPaused(false);
  } catch (err) {
    console.error("[krafna-bot] krafna_admin_resume action failed:", err);
  }
  await publishHomeView(userId);
});

app.action("krafna_feedback_yes", async ({ body, ack, client }) => {
  await ack();
  try {
    const matchId = body.actions[0].value;
    const match = await db.get(matchId);
    if (match && match.metAt === null) {
      await db.set(matchId, { ...match, metAt: new Date().toISOString() });
    }
    await client.chat.postMessage({
      channel: body.channel.id,
      text: "🍩 That's great to hear! Thanks for letting us know.",
    });
  } catch (err) {
    console.error("[krafna-bot] krafna_feedback_yes action failed:", err);
    try {
      await client.chat.postMessage({
        channel: body.channel.id,
        text: "⚠️ We couldn't save your response, but thanks for letting us know!",
      });
    } catch (msgErr) {
      console.error("[krafna-bot] Failed to send feedback error message:", msgErr);
    }
  }
});

app.action("krafna_feedback_no", async ({ body, ack, client }) => {
  await ack();
  try {
    await client.chat.postMessage({
      channel: body.channel.id,
      text: "No worries — hope you get to connect soon! 😊",
    });
  } catch (err) {
    console.error("[krafna-bot] krafna_feedback_no action failed:", err);
  }
});

// ─── /krafna command ──────────────────────────────────────────────────────────

app.command("/krafna", async ({ command, ack, respond, client }) => {
  await ack();

  const subcommand = (command.text || "").trim().toLowerCase();

  try {
    if (subcommand === "join") {
      let profileInfo = {};
      try {
        const result = await client.users.info({ user: command.user_id });
        const profile = result.user;
        profileInfo = {
          displayName: profile.real_name || profile.name || "",
          timezone: profile.tz || null,
          teamId: profile.team_id || command.team_id || null,
        };
      } catch (err) {
        console.error("[krafna-bot] Failed to fetch user profile:", err);
      }

      const existing = await db.getUser(command.user_id);
      if (existing) {
        await db.saveUser(command.user_id, { ...existing, optedIn: true, ...profileInfo });
        await respond({
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: "🍩 Welcome back! You're opted in to krafna chats again." },
            },
          ],
          text: "🍩 Welcome back! You're opted in to krafna chats again.",
        });
      } else {
        await db.saveUser(command.user_id, {
          userId: command.user_id,
          displayName: profileInfo.displayName || "",
          timezone: profileInfo.timezone || null,
          teamId: profileInfo.teamId || command.team_id || null,
          optedIn: true,
          joinedAt: new Date().toISOString(),
          lastMatchedAt: null,
        });
        await respond({
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "🍩 *You're in!* You've been added to the krafna chat pool. We'll match you soon.",
              },
            },
          ],
          text: "🍩 You're in! You've been added to the krafna chat pool.",
        });
      }
      return;
    }

    if (subcommand === "leave") {
      const existing = await db.getUser(command.user_id);
      if (!existing || !existing.optedIn) {
        await respond({
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "You're not currently opted in to krafna chats. Use `/krafna join` to sign up.",
              },
            },
          ],
          text: "You're not currently opted in to krafna chats.",
        });
        return;
      }
      await db.saveUser(command.user_id, { ...existing, optedIn: false });
      await respond({
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "👋 You've been removed from the krafna chat pool. Use `/krafna join` any time to come back.",
            },
          },
        ],
        text: "👋 You've been removed from the krafna chat pool.",
      });
      return;
    }

    if (subcommand === "status") {
      const user = await db.getUser(command.user_id);
      if (!user || !user.optedIn) {
        await respond({
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "❌ You are *not* opted in to krafna chats. Use `/krafna join` to sign up.",
              },
            },
          ],
          text: "You are not opted in to krafna chats.",
        });
        return;
      }
      const joinedDate = new Date(user.joinedAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      await respond({
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `✅ You are *opted in* to krafna chats.\n*Joined:* ${joinedDate}`,
            },
          },
        ],
        text: "✅ You are opted in to krafna chats.",
      });
      return;
    }

    await respond({
      blocks: [
        { type: "header", text: { type: "plain_text", text: "🍩 Krafna Chat", emoji: true } },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              "• `/krafna join` — sign up for krafna chats\n" +
              "• `/krafna leave` — opt out of krafna chats\n" +
              "• `/krafna status` — check your current status",
          },
        },
      ],
      text: "🍩 Krafna Chat — use a subcommand to get started",
    });
  } catch (err) {
    await safeRespond(respond, err, `/krafna ${subcommand} error`);
  }
});

// ─── /krafna-admin command ────────────────────────────────────────────────────

app.command("/krafna-admin", async ({ command, ack, respond }) => {
  await ack();

  const subcommand = (command.text || "").trim().toLowerCase();

  if (!isAdmin(command.user_id)) {
    await respond({
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "🔒 You don't have permission to use this command." },
        },
      ],
      text: "You don't have permission to use this command.",
    });
    return;
  }

  try {
    if (subcommand === "run") {
      const users = await matcher.getEligibleUsers();
      if (users.length < 2) {
        await respond({
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `⚠️ Not enough opted-in users to run a round (found *${users.length}*). At least 2 are needed.`,
              },
            },
          ],
          text: "Not enough opted-in users to run a round.",
        });
        return;
      }

      const pairs = await matcher.buildPairs(users);
      if (pairs.length === 0) {
        await respond({
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "⚠️ Could not form any pairs from the eligible user pool. Everyone may have been matched recently.",
              },
            },
          ],
          text: "Could not form any pairs.",
        });
        return;
      }

      const saved = await matcher.saveMatches(pairs);
      const round = await db.incrementRound();

      const pairLines = saved.map((m) => `• <@${m.users[0]}> ↔ <@${m.users[1]}>`).join("\n");
      const satOut = await db.get("meta:lastSatOut");
      const satOutLine = satOut ? `\n_Sitting out this round: <@${satOut}>_` : "";

      await respond({
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `🍩 *Round ${round - 1} complete!* ${pairs.length} pair(s) matched:\n\n${pairLines}${satOutLine}`,
            },
          },
        ],
        text: `🍩 Round ${round - 1} complete! ${pairs.length} pair(s) matched.`,
      });

      await notifications.notifyPairs(app, saved).catch((err) =>
        console.error("[krafna-bot] notifyPairs error:", err)
      );
      return;
    }

    if (subcommand === "pairs") {
      const allMatches = await db.getMatches("match:");
      if (allMatches.length === 0) {
        await respond({
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "🍩 No matches have been run yet. Use `/krafna-admin run` to start a round.",
              },
            },
          ],
          text: "No matches have been run yet.",
        });
        return;
      }

      const maxRound = Math.max(...allMatches.map((m) => m.round ?? 0));
      const latestMatches = allMatches.filter((m) => m.round === maxRound);
      const pairLines = latestMatches.map((m) => `• <@${m.users[0]}> ↔ <@${m.users[1]}>`).join("\n");

      await respond({
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `🍩 *Pairs from round ${maxRound}:*\n\n${pairLines}` },
          },
        ],
        text: `🍩 Pairs from round ${maxRound}`,
      });
      return;
    }

    if (subcommand === "round") {
      const round = await db.getRound();
      const users = await matcher.getEligibleUsers();
      await respond({
        blocks: [
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Current round:*\n${round}` },
              { type: "mrkdwn", text: `*Users in pool:*\n${users.length}` },
            ],
          },
        ],
        text: `🍩 Current round: ${round} | Users in pool: ${users.length}`,
      });
      return;
    }

    if (subcommand === "pause") {
      await db.setSchedulerPaused(true);
      await respond({
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "⏸️ *Scheduler paused.* Automatic matching rounds will be skipped until resumed.",
            },
          },
        ],
        text: "⏸️ Scheduler paused.",
      });
      return;
    }

    if (subcommand === "resume") {
      await db.setSchedulerPaused(false);
      await respond({
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "▶️ *Scheduler resumed.* Automatic matching rounds will run as scheduled.",
            },
          },
        ],
        text: "▶️ Scheduler resumed.",
      });
      return;
    }

    if (subcommand === "schedule") {
      const config = await scheduler.getSchedulerConfig();
      const statusIcon = config.paused ? "⏸️ Paused" : "▶️ Active";
      await respond({
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                `🍩 *Scheduler status:* ${statusIcon}\n` +
                `*Schedule:* ${config.description}\n` +
                `*Cron expression:* \`${config.cronExpression}\``,
            },
          },
        ],
        text: `Scheduler: ${statusIcon} — ${config.description}`,
      });
      return;
    }

    if (subcommand.startsWith("schedule set ")) {
      const rest = command.text.trim().slice("schedule set ".length).trim();

      let cronExpression, description;

      const quotedMatch = rest.match(/^"([^"]+)"\s+"([^"]+)"$/);
      if (quotedMatch) {
        cronExpression = quotedMatch[1];
        description = quotedMatch[2];
      } else {
        const parts = rest.split(/\s+/);
        if (parts.length < 6) {
          await respond({
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text:
                    "⚠️ *Usage:* `/krafna-admin schedule set <cron expression (5 parts)> <description>`\n" +
                    'Example: `/krafna-admin schedule set "0 9 1,15 * *" "1st and 15th at 9am"`',
                },
              },
            ],
            text: "Usage: /krafna-admin schedule set <cron> <description>",
          });
          return;
        }
        cronExpression = parts.slice(0, 5).join(" ");
        description = parts.slice(5).join(" ");
      }

      const { validate } = require("node-cron");
      if (!validate(cronExpression)) {
        await respond({
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `❌ *Invalid cron expression:* \`${cronExpression}\`\nPlease check the format and try again.`,
              },
            },
          ],
          text: `Invalid cron expression: ${cronExpression}`,
        });
        return;
      }

      await scheduler.setSchedulerConfig(cronExpression, description);
      await respond({
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `✅ *Schedule updated.*\n*Schedule:* ${description}\n*Cron expression:* \`${cronExpression}\``,
            },
          },
        ],
        text: `✅ Schedule updated: ${description}`,
      });
      return;
    }

    if (subcommand === "stats") {
      const stats = await reports.getStats();
      const statusIcon = stats.scheduler.paused ? "⏸️ Paused" : "▶️ Active";
      const mostActiveText =
        stats.mostActive.length > 0
          ? stats.mostActive.map((u) => `<@${u.userId}> (${u.count})`).join("  ·  ")
          : "_No data yet_";
      await respond({
        blocks: [
          { type: "header", text: { type: "plain_text", text: "🍩 Krafna Chat Stats", emoji: true } },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Opted-in users:*\n${stats.totalOptedInUsers}` },
              { type: "mrkdwn", text: `*Rounds run:*\n${stats.totalRounds}` },
              { type: "mrkdwn", text: `*Total pairs:*\n${stats.totalPairs}` },
              {
                type: "mrkdwn",
                text: `*Meetings confirmed:*\n${stats.confirmedMeetings} (${stats.confirmationRate}%)`,
              },
            ],
          },
          { type: "section", text: { type: "mrkdwn", text: `*Most active:* ${mostActiveText}` } },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Scheduler:* ${statusIcon} — ${stats.scheduler.description}`,
            },
          },
        ],
        text: "🍩 Krafna Chat Stats",
      });
      return;
    }

    if (subcommand === "history") {
      const allMatches = await db.getMatches("match:");
      if (allMatches.length === 0) {
        await respond({
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "🍩 No match history yet. Use `/krafna-admin run` to run a round.",
              },
            },
          ],
          text: "No match history yet.",
        });
        return;
      }
      const maxRound = Math.max(...allMatches.map((m) => m.round ?? 0));
      const historyBlocks = [
        { type: "header", text: { type: "plain_text", text: "🍩 Match History", emoji: true } },
      ];
      for (let r = maxRound; r >= 1; r--) {
        const roundMatches = allMatches.filter((m) => m.round === r);
        if (roundMatches.length === 0) continue;
        const roundDate = new Date(roundMatches[0].createdAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        historyBlocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `*Round ${r}* — ${roundDate}` },
        });
        for (const match of roundMatches) {
          const icon = match.metAt ? "✅" : "❌";
          historyBlocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${icon}  <@${match.users[0]}> ↔ <@${match.users[1]}>`,
            },
          });
        }
        if (historyBlocks.length >= 48) break;
      }
      await respond({ blocks: historyBlocks, text: "🍩 Match History" });
      return;
    }

    if (subcommand === "export") {
      const allMatches = await db.getMatches("match:");
      if (allMatches.length === 0) {
        await respond({
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: "🍩 No match history to export yet." },
            },
          ],
          text: "No match history to export yet.",
        });
        return;
      }
      const maxRound = Math.max(...allMatches.map((m) => m.round ?? 0));
      const lines = [];
      for (let r = 1; r <= maxRound; r++) {
        const roundMatches = allMatches.filter((m) => m.round === r);
        if (roundMatches.length === 0) continue;
        const roundDate = new Date(roundMatches[0].createdAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        lines.push(`Round ${r} — ${roundDate}`);
        for (const match of roundMatches) {
          const met = match.metAt ? "Yes" : "No";
          lines.push(`  - ${match.users[0]} <-> ${match.users[1]} | Met: ${met}`);
        }
        lines.push("");
      }
      await respond({
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: "🍩 *Match History Export*" } },
          {
            type: "section",
            text: { type: "mrkdwn", text: "```" + lines.join("\n") + "```" },
          },
        ],
        text: "🍩 Match History Export",
      });
      return;
    }

    await respond({
      blocks: [
        { type: "header", text: { type: "plain_text", text: "🍩 Krafna Admin", emoji: true } },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              "*Matching:*\n" +
              "• `/krafna-admin run` — run a matching round now\n" +
              "• `/krafna-admin pairs` — show the most recent round's pairs\n" +
              "• `/krafna-admin round` — show current round number and pool size\n\n" +
              "*Reporting:*\n" +
              "• `/krafna-admin stats` — view engagement stats\n" +
              "• `/krafna-admin history` — full match history with meeting status\n" +
              "• `/krafna-admin export` — copy-friendly text export of all match history\n\n" +
              "*Scheduling:*\n" +
              "• `/krafna-admin schedule` — show the current schedule\n" +
              "• `/krafna-admin schedule set <cron> <description>` — update the schedule\n" +
              "• `/krafna-admin pause` — pause automatic matching\n" +
              "• `/krafna-admin resume` — resume automatic matching",
          },
        },
      ],
      text: "🍩 Krafna Admin — use a subcommand to get started",
    });
  } catch (err) {
    await safeRespond(respond, err, `/krafna-admin ${subcommand} error`);
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

(async () => {
  try {
    await app.start();
    console.log("[krafna-bot] ⚡ App is running via Socket Mode");
    await scheduler.startScheduler(app);
  } catch (err) {
    console.error("[krafna-bot] Failed to start:", err);
    process.exit(1);
  }
})();
