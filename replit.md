# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/krafna-bot run start` — start the Slack krafna chat bot

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

### `artifacts/coffee-bot/` — Slack Krafna Chat Bot
- **Package name**: `@workspace/krafna-bot`
- **Framework**: Slack Bolt for JavaScript (Socket Mode, no public URL needed)
- **Runtime**: plain CommonJS Node.js (`type: commonjs`)
- **Entry point**: `app.js`
- **DB helper**: `db.js` — thin wrappers around `@replit/database` (`get`, `set`, `delete`, `list`)
- **Slash commands**: `/krafna join`, `/krafna leave`, `/krafna status`, `/krafna` (help)
- **Admin commands**: `/krafna-admin run`, `pairs`, `round`, `schedule`, `schedule set`, `pause`, `resume`, `stats`, `history`, `export`
- **App Home tab**: two views — enhanced user view (match history, schedule, opted-in status) and admin dashboard (stats, match history table, Run/Pause/Resume buttons). Admin access controlled by `ADMIN_USER_IDS`.
- **Matcher**: `matcher.js` — `getEligibleUsers`, `buildPairs` (shuffle + recent-pair avoidance), `saveMatches`
- **Scheduler**: `scheduler.js` — two cron jobs: matching rounds (configurable, default 1st/15th at 9am) and daily follow-ups
- **Notifications**: `notifications.js` — `notifyPairs` (DM with icebreaker), `sendReminder` (day 3), `sendFeedbackRequest` (day 7 with 👍/👎 buttons)
- **Reports**: `reports.js` — `getStats()` returning opted-in user count, rounds, pairs, confirmation rate, most active users, scheduler status
- **Scopes required**: `commands`, `chat:write`, `im:write`, `users:read`
- **Events required**: `app_home_opened`
- **Env vars required**: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`
- **Env vars optional**: `ADMIN_USER_IDS` (comma-separated Slack user IDs; if empty, all users can use admin commands)
