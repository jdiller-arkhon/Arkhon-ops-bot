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
  src/layout.ts          LayoutStore: channel/role ids from /setup (DB) with env overrides
  src/startup.ts         panels, posted content, AutoMod: runs on startup and after /setup
  src/verification/      member ID verification: api.ts (website client), handlers.ts (#verify flow),
                         service.ts (link/unlink, lockdown, role guard), shield.ts (pure alt/raid logic),
                         webhook.ts (signed website events), audit.ts (events + #mod-log)
  src/setup/             blueprint.ts (the whole server as data), plan.ts (pure diff),
                         apply.ts (Discord side), content.ts (welcome/rules), session.ts (preview/confirm)
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
- **Server layout:** never hard-code channel or role ids. Feature code gets them from
  `ctx.layout.require()` (interactions; throws a user-facing "run /setup server" error) or
  `ctx.layout.current` (events/webhooks; skip when undefined). To add a channel or role, add it to
  `src/setup/blueprint.ts`; if a feature needs its id, add the key to `REQUIRED_RESOURCES` or
  `OPTIONAL_RESOURCES` in `src/layout.ts` and map it in `buildLayout()`. Blueprint keys are stored
  in the database, so never rename a key (names are free to change).
- **Buildout safety:** `/setup server` must stay previewable and idempotent. The planner is pure
  and tested; the executor treats every resource independently and saves ids as it goes. Never add
  deletion of resources outside the blueprint.
- **Member verification:** the website is the source of truth for links; the bot mirrors them in
  `ops_member_links`. Keep the member ID algorithm identical to the website's
  (`lib/platform/member-id.ts` in Arkhon-Industries) and the pinned `MEMBER_ID_TEST_VECTORS` equal
  in both repos. Webhooks must stay timestamped + HMAC + de-duplicated. Never treat a typed member
  ID alone as proof of ownership.
- **No TODOs, stubs or placeholder functions.** Everything merged must run.

## Testing rules

- Unit-test pure logic without Discord or a database: state machines, parsing, signatures, config,
  formatting. Keep Discord-facing code thin so the logic lives in pure modules.
- Tests live in `<package>/test/*.test.ts` and import sources via relative paths.
- Use `test/fixtures.ts` (`validOpsEnv`) for a valid environment; tests must never need real
  tokens, network access or a database. HTTP handlers are tested by starting the server on port 0
  with a fake `OpsContext`.
- Required coverage areas: ticket state transitions, webhook signature verification, config
  validation, and the server blueprint/planner (`blueprint.test.ts`, `setup-plan.test.ts`,
  `setup-apply.test.ts` with an in-memory guild). Add tests with every behavior change in those areas.

## Discord server permission setup

`/setup server` builds roles, categories, channels and their permissions from
`bots/ops/src/setup/blueprint.ts`; that file is the source of truth for who can see and post where.
Summary of the model:

- Role order (top to bottom): the bot's own role, Arkhon Team, Moderator, Certa Staff, Argus Staff,
  Certa User, Argus User, Verified (lowest so product colors show). The bot's role must be at the top; it can only manage roles below it.
- **Arkhon Team** is staff for every product (tickets, /ticket, /mod). **Certa/Argus Staff** handle
  their product's tickets. **Moderator** can use /mod, /member lookup|find and /security, and sees product
  channels, but does not handle tickets: Manage Threads is denied in SUPPORT and #ticket-archive is
  hidden from them. Administrators pass every check. Staff permissions (Manage Messages, Timeout Members) make
  `/ticket` and `/mod` visible; the bot also checks roles on every action.
- The server is gated: @everyone sees only #welcome, #rules and #verify. **Verified** (granted when a
  member links their member ID) unlocks the rest; #verify hides itself from verified members.
- Product categories are hidden from @everyone and unlocked by Certa User / Argus User (granted by
  the #start-here panel, verified members only). Staff categories are visible only to staff roles.
- #support is read-only except inside private ticket threads (members can post in threads but not
  create them). Anyone with Manage Threads on #support can see every ticket; keep that to roles that
  should.
- #ticket-archive and #mod-log are written only by the bot.
- The feedback forum requires a tag and has `Certa` and `Argus` tags; the bot reads those names.
- Announcement pings work because Certa User / Argus User are mentionable.
- Private-channel ticket fallback (`TICKET_MODE=channel`) needs Manage Channels in
  `TICKET_CATEGORY_ID`.
- AutoMod rules are matched by name (`Arkhon: ...`); renaming one makes the bot create it again.
