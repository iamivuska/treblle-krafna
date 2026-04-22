const ICEBREAKERS = [
  "What's a skill you've been meaning to learn?",
  "What's the best meal you've had recently?",
  "What's a project you're most proud of this year?",
  "If you could work from anywhere for a month, where would it be?",
  "What's a book, podcast, or show you've enjoyed lately?",
  "What did you want to be when you grew up?",
  "What's something most people at work don't know about you?",
  "What's your go-to way to recharge after a busy week?",
  "What's a tool or app you couldn't live without?",
  "If you could switch roles with anyone in the company for a day, who would it be?",
];

function pickIcebreaker() {
  return ICEBREAKERS[Math.floor(Math.random() * ICEBREAKERS.length)];
}

async function openDm(app, userId) {
  try {
    const result = await app.client.conversations.open({ users: userId });
    return result.channel.id;
  } catch (err) {
    throw new Error(
      `Failed to open DM with ${userId}: ${err.message ?? err}`
    );
  }
}

async function sendDm(app, userId, payload) {
  const channel = await openDm(app, userId);
  await app.client.chat.postMessage({ channel, ...payload });
}

async function notifyPairs(app, pairs) {
  let sent = 0;
  let failed = 0;

  for (const match of pairs) {
    const [userId1, userId2] = match.users;
    const icebreaker = pickIcebreaker();

    const buildPayload = (partnerId) => ({
      text: `🍩 You've been matched with <@${partnerId}> for a krafna chat!`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `🍩 *You've been matched with <@${partnerId}> for a krafna chat!*\n\n` +
              `Reach out and find a time to connect.\n\n` +
              `*Conversation starter:*\n_${icebreaker}_`,
          },
        },
      ],
    });

    try {
      await sendDm(app, userId1, buildPayload(userId2));
      sent++;
    } catch (err) {
      failed++;
      console.error(
        `[krafna-bot] notifyPairs: failed to DM ${userId1} (match ${match.matchId}):`,
        err.message ?? err
      );
    }

    try {
      await sendDm(app, userId2, buildPayload(userId1));
      sent++;
    } catch (err) {
      failed++;
      console.error(
        `[krafna-bot] notifyPairs: failed to DM ${userId2} (match ${match.matchId}):`,
        err.message ?? err
      );
    }
  }

  console.log(
    `[krafna-bot] notifyPairs complete: ${sent} DM(s) sent, ${failed} failed.`
  );
}

async function sendReminder(app, match) {
  if (match.metAt !== null) return;
  const [userId1, userId2] = match.users;

  try {
    await sendDm(app, userId1, {
      text: `Just a friendly nudge — have you connected with <@${userId2}> yet? 😊`,
    });
  } catch (err) {
    console.error(
      `[krafna-bot] sendReminder: failed to DM ${userId1} (match ${match.matchId}):`,
      err.message ?? err
    );
  }

  try {
    await sendDm(app, userId2, {
      text: `Just a friendly nudge — have you connected with <@${userId1}> yet? 😊`,
    });
  } catch (err) {
    console.error(
      `[krafna-bot] sendReminder: failed to DM ${userId2} (match ${match.matchId}):`,
      err.message ?? err
    );
  }
}

async function sendFeedbackDm(app, toUserId, partnerUserId, matchId) {
  try {
    await sendDm(app, toUserId, {
      text: `Did you get to meet with <@${partnerUserId}>?`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Did you get to meet with <@${partnerUserId}> for your krafna chat? 😊`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "👍 Yes!" },
              style: "primary",
              action_id: "krafna_feedback_yes",
              value: matchId,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "👎 Not yet" },
              action_id: "krafna_feedback_no",
              value: matchId,
            },
          ],
        },
      ],
    });
  } catch (err) {
    console.error(
      `[krafna-bot] sendFeedbackDm: failed to DM ${toUserId} (match ${matchId}):`,
      err.message ?? err
    );
  }
}

async function sendFeedbackRequest(app, match) {
  const [userId1, userId2] = match.users;
  await sendFeedbackDm(app, userId1, userId2, match.matchId);
  await sendFeedbackDm(app, userId2, userId1, match.matchId);
}

module.exports = { notifyPairs, sendReminder, sendFeedbackRequest };
