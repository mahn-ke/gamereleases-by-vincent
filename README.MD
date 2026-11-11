# gamereleases.by.vincent.mahn.ke

A game release calendar at [gamereleases.by.vincent.mahn.ke](https://gamereleases.by.vincent.mahn.ke), laid out like releases.com:
covers, platforms, trailers and a reminder bell per game.

- **Browse** upcoming releases by day (`/`), the most anticipated ones (`/hot`), or search all of IGDB (`/search`). Filter by platform.
- **Remind**: log in with the SSO account (sso.by.vincent.mahn.ke) and click a game's bell. The number next to it counts everyone on this server who tracks it.
- **Email**: at 00:00 Europe/Berlin on the day before a tracked game releases, one mail per user goes to the address on their SSO account. Each game and day is mailed once; runs missed during downtime are caught up the same day. Users can switch these mails off on `/reminders`.
- **Changing the email**: the address belongs to the SSO account, so `/reminders` links to the Keycloak account console. Keycloak doesn't notify apps about profile changes, so the app pulls them: on every login, and silently via `/auth/refresh` (an OIDC request with `prompt=none` that returns immediately while the SSO session is active). The account console's "Back to …" link and the "Refresh from SSO" button both go through it.
- **Calendar feed**: `/reminders` shows a personal `https://gamereleases.by.vincent.mahn.ke/<username>/<secret>.ics` subscription. It needs no login, tells clients to refresh every 6 hours, and can be regenerated at any time, which immediately disables the old address.

## Data

Release dates, covers and trailers come from [IGDB](https://api-docs.igdb.com). Like on releases.com, releases dated only to a month, quarter or year appear as **tentative dates** after the last day of that period ("Nov 2026" after Nov 30, "Q4 2026" and then "2026" after Dec 31), marked with an "Est." label. Mails and calendar feeds only use exact days; TBD releases are left out. Every 6 hours the app syncs games releasing from 14 days ago to 180 days ahead, plus every tracked game. Release days are the UTC calendar days IGDB publishes.

releases.com is no longer used: it has no API and blocks automated clients with a Cloudflare challenge.

State (users, reminders, cached games) lives in SQLite at `DATA_DIR` (`/app/data`, the `data` volume, which is backed up).

## Configuration

| Variable | Source |
| --- | --- |
| `OAUTH_URL`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `OAUTH_NAME` | Repository secrets managed by `mahn-ke/repos` (`oauth_clients`) |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Repository secrets from a [Twitch developer application](https://dev.twitch.tv/console/apps) (client credentials, used for IGDB) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY` (`starttls`, `force_tls` or `off`), `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` | Organization secrets |
| `APP_BASE_URL` | Public origin; used for the SSO redirect and feed URLs |

Without IGDB credentials the app still serves cached data; without SMTP settings it skips mails. `/healthz` reports which integrations are configured.

## Development

```sh
cd app
npm ci
npm test
DATA_DIR=./data APP_BASE_URL=http://localhost:3000 npm start
```

The Docker build runs the test suite, so a failing test fails the deployment.
