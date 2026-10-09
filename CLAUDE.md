# CLAUDE.md

Conventions for working in this repo. Read this before changing code.

## What this is

A pnpm monorepo with Discord bots for the Arkhon Industries pilot community server. The server
covers exactly two products, **Certa** and **Argus**. Product slugs are `certa` / `argus`
everywhere (env vars, DB columns, custom ids); display names come from `productLabel()`.

## Stack

Node.js 20 (>= 20.12), TypeScript 5 strict (ESM, `NodeNext`), discord.js v14, pnpm workspaces,
Prisma 6 (SQLite in dev, PostgreSQL 15 in prod), zod, pino, Vitest, ESLint (flat config) + Prettier,
Docker Compose.

## Layout

```
packages/shared/   @arkhon/shared: loadConfig + env field schemas, createLogger, arkhonEmbed + BRAND_COLOR,
                   products, UserFacingError + handleInteractionError + runInteraction,
                   loadCommands + deployCommands
bots/ops/          @arkhon/ops-bot
  src/index.ts           client, events, startup steps, HTTP server
  src/config.ts          zod env schema -> structured OpsConfig
  src/commands/          one slash command per file, exporting { data, execute }
  src/interactions.ts    routes commands, buttons and modals
  src/tickets/           state.ts (pure state machine), service.ts (Discord side), stats, transcript
  src/onboarding/        role panel, welcome DM
  src/moderation/        AutoMod rules, /mod helpers
  src/releases/          HTTP server, HMAC verification, payload parsing, announcement
  src/feedback/          forum reaction -> GitHub issue
bots/certa/, bots/argus/ placeholders for the next two bots
prisma/schema.prisma     single schema for all bots; prisma/migrations are PostgreSQL migrations
scripts/prisma.mjs       Prisma CLI wrapper that switches to SQLite when DATABASE_URL starts with file:
```

## Commands

```bash
pnpm install          # installs and generates the Prisma client
pnpm typecheck        # tsc -p tsconfig.json (all src + test, resolves @arkhon/shared to src)
pnpm test             # vitest run
pnpm lint             # eslint .
pnpm format           # prettier --write .
pnpm build            # tsc -b bots/ops (builds shared first via project references)
pnpm db:push          # sync schema to the local SQLite database
pnpm db:migrate       # prisma migrate deploy (PostgreSQL)
pnpm dev:ops          # tsx watch + pino-pretty
pnpm deploy:commands  # guild in dev, global when NODE_ENV=production
```

Run `pnpm typecheck && pnpm lint && pnpm test` before committing. All three must pass.

## Conventions

- **Config:** every env var goes through a zod schema and `loadConfig()`. Never read `process.env`
  directly in feature code. Add new variables to `.env.example` and the README table.
- **Workspace imports:** `@arkhon/shared` exports a `development` condition that points at
  `src/index.ts`. tsx (`--conditions=development`), Vitest and `pnpm typecheck` use it, so you do not
  need to build shared during development. Production uses `dist`.
- **ESM:** relative imports include the `.js` extension. Use `import type` for types.
- **Commands:** one file per command in `src/commands/`, named exports `data` and `execute(interaction, ctx)`.
  They are loaded automatically. Every command sets `setDefaultMemberPermissions(...)`,
  `setContexts(InteractionContextType.Guild)` and calls `requireStaff()` (or another explicit check)
  at the top of `execute`.
- **Components:** custom ids are `ops:<feature>:<action>[:<arg>]` built via `src/ids.ts`. Panels
  route by id only, so they keep working across restarts.
- **Errors:** throw `UserFacingError` for anything the user should read (permission denied,
  invalid state). Anything else is logged and the user gets a generic ephemeral message.
  All interactions go through `runInteraction`, which logs name, user id and duration.
- **Embeds:** always `arkhonEmbed()`; never set colors by hand. Pass `product` for product messages.
- **Mentions:** the client defaults to `allowedMentions: { parse: [] }`. Opt in per message with
  explicit `users` / `roles` lists.
- **Database:** models are prefixed with the owning bot (`OpsTicket`) and mapped to `<bot>_<name>`
  tables. No Prisma enums or `@db.*` native types (must work on SQLite and PostgreSQL); status
  columns are strings validated in code. After editing the schema, add a PostgreSQL migration:
  `DATABASE_URL=postgresql://... pnpm exec prisma migrate dev --name <change>` against a dev
  Postgres, or `prisma migrate diff` to produce SQL. Use optimistic `updateMany({ where: { id, status } })`
  for state transitions.
- **Logging:** pino via `createLogger(botName)`. Log objects first, message second. No `console.log`
  outside entry-point fatal errors.
- **No TODOs, stubs or placeholder functions.** Everything merged must run.

## Testing rules

- Unit-test pure logic without Discord or a database: state machines, parsing, signatures, config,
  formatting. Keep Discord-facing code thin so the logic lives in pure modules.
- Tests live in `<package>/test/*.test.ts` and import sources via relative paths.
- Use `test/fixtures.ts` (`validOpsEnv`) for a valid environment; tests must never need real
  tokens, network access or a database. HTTP handlers are tested by starting the server on port 0
  with a fake `OpsContext`.
- Required coverage areas: ticket state transitions, webhook signature verification, config
  validation. Add tests with every behavior change in those areas.

## Discord server permission setup

Roles (create in this order, top to bottom): `Arkhon Ops` (the bot's role, must sit above the
user roles), `Certa Staff`, `Argus Staff`, `Certa User`, `Argus User`.

Give `Certa Staff` and `Argus Staff` the **Manage Messages** and **Timeout Members** permissions so
`/ticket` and `/mod` are visible to them (these are the commands' default member permissions; you
can override per role in Server Settings → Integrations → Arkhon Ops). Staff must also hold their
staff role: the bot checks roles on every staff action, so permissions alone are not enough
(administrators always pass).

Categories and channels:

| Category / channel  | @everyone          | Certa User | Argus User | Certa Staff         | Argus Staff         | Bot                                                                 |
| ------------------- | ------------------ | ---------- | ---------- | ------------------- | ------------------- | ------------------------------------------------------------------- |
| `#start-here`       | view, no send      |            |            |                     |                     | view, send                                                          |
| `#announcements`    | view, no send      |            |            |                     |                     | view, send, embed                                                   |
| `#support`          | view, no send      |            |            | view                | view                | view, send, create private threads, send in threads, manage threads |
| `#feedback` (forum) | view, create posts |            |            | view, add reactions | view, add reactions | view, send in threads, read history                                 |
| **Certa** category  | deny view          | allow view |            | allow view          |                     | allow view                                                          |
| **Argus** category  | deny view          |            | allow view |                     | allow view          | allow view                                                          |
| `#ticket-archive`   | deny view          |            |            | allow view          | allow view          | view, send, attach files                                            |
| `#mod-log`          | deny view          |            |            | allow view          | allow view          | view, send, embed                                                   |

Notes:

- Product categories are unlocked purely by the `Certa User` / `Argus User` roles: deny `View Channel`
  for @everyone on the category, allow it for the user role and the matching staff role, and keep
  the channels inside synced to the category.
- `#support`: members must be able to see the panel and click buttons, but not post. Private
  ticket threads are visible only to members added to them (the user, the bot, staff who are
  @mentioned or added). Anyone with **Manage Threads** on `#support` can see every private thread;
  give that only to roles that should see all tickets.
- Private channel fallback (`TICKET_MODE=channel` or no thread permissions): the bot creates
  channels under `TICKET_CATEGORY_ID` with overwrites for the user, the staff role and itself, so
  it needs **Manage Channels** there.
- `#feedback`: create forum tags named exactly `Certa` and `Argus`, and turn on **Require people to
  select tags when posting**. The bot also reminds posters who skip the tag.
- `#announcements`: the bot pings `Certa User` or `Argus User`. Either make those roles mentionable
  or keep **Mention @everyone, @here, and All Roles** on the bot's role.
- Native Onboarding: in Server Settings → Onboarding, add a question "Which products do you use?"
  with answers that grant `Certa User` and/or `Argus User`. The `#start-here` panel is the fallback.
- AutoMod: the bot needs **Manage Server** to create rules. Rules are matched by name
  (`Arkhon: ...`); renaming one makes the bot create it again on next start.
