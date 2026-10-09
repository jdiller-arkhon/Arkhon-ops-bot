# Arkhon Bots

Discord bots for the Arkhon Industries pilot community server, which covers two products:
**Certa** (drone flight operations and compliance logbook) and **Argus**.

| Bot                                                                        | Folder       | Status  |
| -------------------------------------------------------------------------- | ------------ | ------- |
| Ops Bot (support tickets, onboarding, moderation, release notes, feedback) | `bots/ops`   | ready   |
| Certa Bot                                                                  | `bots/certa` | planned |
| Argus Bot                                                                  | `bots/argus` | planned |

Stack: Node.js 20, TypeScript 5 (strict), discord.js v14, pnpm workspaces, Prisma (SQLite in dev,
PostgreSQL 15 in prod), Vitest, ESLint + Prettier, pino, Docker.

---

## Ops Bot features

- **Support tickets.** A panel in `#support` with **Certa Support** / **Argus Support** buttons opens a
  modal (subject, description, optional app version) and creates a private thread for the user and
  the matching staff role. If private threads are unavailable it falls back to a private channel.
  Staff buttons: **Claim**, **Mark Waiting on User**, **Close**. Closing DMs a plain-text transcript
  to the user, posts it to `#ticket-archive`, then locks and archives the thread.
  `/ticket stats` shows open tickets per product and median time to first staff reply / close.
- **Onboarding.** A fallback role panel in `#start-here` (**Certa User**, **Argus User**, **Both**)
  next to Discord's native Onboarding, plus a welcome DM on join.
- **Moderation.** AutoMod rules created on startup (mention spam, invite links outside staff,
  keyword list from config). `/mod timeout`, `/mod warn`, `/mod history`, all logged to `#mod-log`
  and stored in the database.
- **Release notes.** `POST /webhooks/release` (HMAC-SHA256 signed) and GitHub Releases webhooks
  post an embed to `#announcements` that pings only the matching product role.
- **Feedback pipeline.** Staff react to a `#feedback` forum post with the configured emoji to open a
  GitHub issue in the product's repo (labels: product, `community-feedback`); the bot replies with
  the link.

---

## 1. Create the Discord application

1. Go to <https://discord.com/developers/applications> and click **New Application**.
2. **General Information:** copy the **Application ID** into `DISCORD_CLIENT_ID`.
3. **Bot:** click **Reset Token** and copy it into `DISCORD_TOKEN`. Turn **Public Bot** off.
4. **Bot → Privileged Gateway Intents:** enable
   - **Server Members Intent** (welcome DMs, staff role lookups)
   - **Message Content Intent** (needed: ticket transcripts and GitHub issue bodies contain message text)

   The bot connects with these gateway intents: `Guilds`, `GuildMembers`, `GuildMessages`,
   `MessageContent`, `GuildMessageReactions` (feedback promotion reactions).

5. **Installation / OAuth2 → URL Generator:** scopes `bot` and `applications.commands`, with these
   bot permissions: View Channels, Send Messages, Send Messages in Threads, Create Private Threads,
   Manage Threads, Manage Channels, Manage Roles, Moderate Members, Manage Server (AutoMod),
   Embed Links, Attach Files, Read Message History, Add Reactions, Mention Everyone (role pings).
   Or use this URL with your client id:

   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot%20applications.commands&permissions=1460557565040
   ```

6. Open the URL, pick the Arkhon server, and authorize.
7. In **Server Settings → Roles**, drag the bot's role **above** `Certa User` and `Argus User` so it
   can assign them, and above regular members so it can time them out.

## 2. Prepare the server

Create the channels and roles listed in `.env.example` and copy their IDs (enable Developer Mode,
then right-click → **Copy ID**). Channel permission setup is documented in
[`CLAUDE.md`](./CLAUDE.md#discord-server-permission-setup).

## 3. Environment variables

```bash
cp .env.example .env
```

Fill in every value. The bot validates the environment at startup and exits with a list of every
missing or invalid variable. Key groups:

| Variables                                                         | Purpose                                                                                                                                              |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`          | Bot identity and the one server it serves                                                                                                            |
| `DATABASE_URL`                                                    | `file:./dev.db` for SQLite, or a `postgresql://` URL                                                                                                 |
| `*_CHANNEL_ID`                                                    | `#support`, `#ticket-archive`, `#start-here`, `#mod-log`, `#announcements`, `#feedback`, plus one channel in each product category for welcome links |
| `*_ROLE_ID`                                                       | `Certa Staff`, `Argus Staff`, `Certa User`, `Argus User`                                                                                             |
| `TICKET_MODE`, `TICKET_CATEGORY_ID`                               | Private threads (default) or private channels                                                                                                        |
| `AUTOMOD_MENTION_LIMIT`, `AUTOMOD_KEYWORDS`                       | AutoMod rule settings                                                                                                                                |
| `WEBHOOK_PORT`, `RELEASE_WEBHOOK_SECRET`                          | Release webhook server                                                                                                                               |
| `GITHUB_WEBHOOK_SECRET`, `GITHUB_RELEASE_REPOS`                   | Optional: GitHub Releases webhooks (`certa=owner/repo,argus=owner/repo`)                                                                             |
| `GITHUB_TOKEN`, `GITHUB_FEEDBACK_REPOS`, `FEEDBACK_PROMOTE_EMOJI` | Optional: feedback → GitHub Issues                                                                                                                   |

## 4. Run locally

Requires Node.js 20.12+ and pnpm 10 (`corepack enable`).

```bash
pnpm install            # also generates the Prisma client
pnpm db:push            # create the SQLite schema (DATABASE_URL=file:./dev.db)
pnpm deploy:commands    # register slash commands to DISCORD_GUILD_ID (instant)
pnpm dev:ops            # run with reload and pretty logs
```

Other scripts:

```bash
pnpm test               # Vitest
pnpm typecheck          # tsc over all packages and tests
pnpm lint               # ESLint
pnpm format             # Prettier
pnpm build              # compile to bots/ops/dist
pnpm start:ops          # run the compiled bot
```

Slash commands: `pnpm deploy:commands` registers to the dev guild unless `NODE_ENV=production`, in
which case it registers globally (pass `--guild` or `--global` to override). Global commands can take
up to an hour to show up.

## 5. Run with Docker

```bash
cp .env.example .env    # fill it in; DATABASE_URL is overridden by compose
docker compose up -d --build
docker compose logs -f ops
```

Compose runs PostgreSQL 15 and the Ops Bot. On start the container applies Prisma migrations
(`prisma migrate deploy`) and then starts the bot. Register production slash commands once:

```bash
docker compose run --rm ops node bots/ops/dist/deploy-commands.js
```

The webhook server listens on `WEBHOOK_PORT` (default 3000). Put it behind HTTPS (a reverse proxy
or tunnel) before pointing external services at it. `GET /healthz` reports readiness.

## 6. Release webhooks

Custom payload:

```bash
BODY='{"product":"certa","version":"2.5.0","notes":"- Faster logbook sync\n- New export format"}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$RELEASE_WEBHOOK_SECRET" -r | cut -d' ' -f1)"
curl -X POST https://ops.example.com/webhooks/release \
  -H "content-type: application/json" -H "x-arkhon-signature: $SIG" -d "$BODY"
```

`product` is `certa` or `argus`; `notes` is markdown; an optional `url` links the full notes.
Each product/version is announced once; repeats return `200 {"status":"duplicate"}`.

GitHub Releases: in the repo's **Settings → Webhooks**, set the payload URL to
`https://ops.example.com/webhooks/github` (or `/webhooks/release`), content type
`application/json`, secret = `GITHUB_WEBHOOK_SECRET`, and select only the **Releases** event. The
repo must be listed in `GITHUB_RELEASE_REPOS`. Only `published` releases are announced.

## 7. Feedback → GitHub Issues

Create a fine-grained token with **Issues: Read and write** on the feedback repos and set
`GITHUB_TOKEN` and `GITHUB_FEEDBACK_REPOS`. GitHub creates the `certa`, `argus` and
`community-feedback` labels on first use if they don't exist yet.
