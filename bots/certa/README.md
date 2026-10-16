# Certa bot

`@arkhon/certa-bot`: Certa's drone flight logbook and compliance companion. It is its own Discord
application, shares the database with the Ops Bot (`certa_*` tables) and reads the channels that
`/setup server` creates (`#flight-logs`, `#preflight`, `#certa-general`).

| Command                         | What it does                                                          |
| ------------------------------- | --------------------------------------------------------------------- |
| `/certa link code:<code>`       | Links a Certa account with a one-time code from Certa                 |
| `/certa unlink`                 | Removes the link, reminder history and unshared flight summaries      |
| `/certa reminders state:on/off` | Recurrent training reminder DMs (60/30/14/3 days before due)          |
| `/log mission:<type>`           | Form to log a flight, with an optional "Share to #flight-logs" button |
| `/hours`, `/currency`           | Flight totals; Part 107 recurrent due date                            |
| `/preflight icao:<code>`        | METAR, TAF, Kp and nearby TFRs with a GO/CAUTION summary (advisory)   |
| `/leaderboard [period]`         | Top 10 by flight time this month or all time                          |

Scheduled jobs: daily reminders (`CERTA_REMINDER_TIME`), daily preflight for
`CERTA_PREFLIGHT_AIRPORTS` (`CERTA_PREFLIGHT_TIME`), and the monthly leaderboard on the 1st.
Each runs once per occurrence, even across restarts.

Settings are in the Certa section of `.env.example`. `CERTA_API_MODE=mock` runs everything off the
bot's database until the Certa API ships. The bot never stores FAA certificate numbers.

```bash
pnpm dev:certa                 # local, reads .env
pnpm deploy:commands:certa     # register slash commands
```
