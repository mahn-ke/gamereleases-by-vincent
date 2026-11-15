# gamereleases.by.vincent.mahn.ke

A game release calendar at [gamereleases.by.vincent.mahn.ke](https://gamereleases.by.vincent.mahn.ke), laid out like releases.com:
covers, platforms, trailers and a reminder bell per game.

- **Browse** upcoming releases by day (`/`), the most anticipated ones (`/hot`), or search all of IGDB (`/search`). Filter by platform.
- **Remind**: log in with the SSO account (sso.by.vincent.mahn.ke) and click a game's bell. The number next to it counts everyone on this server who tracks it.
- **Email**: at 00:00 Europe/Berlin on the day before a tracked game releases, one mail per user goes to the address on their SSO account. Each game and day is mailed once; runs missed during downtime are caught up the same day. Users can switch these mails off on `/reminders`.
- **Changing the email**: the address belongs to the SSO account, so `/reminders` links to the Keycloak account console. Keycloak doesn't notify apps about profile changes, so the app pulls them: on every login, and silently via `/auth/refresh` (an OIDC request with `prompt=none` that returns immediately while the SSO session is active). The account console's "Back to …" link and the "Refresh from SSO" button both go through it.
- **Calendar feed**: `/reminders` shows a personal `https://gamereleases.by.vincent.mahn.ke/<username>/<secret>.ics` subscription. It needs no login, tells clients to refresh every 6 hours, and can be regenerated at any time, which immediately disables the old address.

## Platform filters

Calendar and Hot remember signed-in users' platform choices in SQLite across sessions and devices. Anonymous choices stay in the URL. Shared/bookmarked URLs override the current view without overwriting account preferences; deliberately changing a checkbox or sidebar shortcut saves the new selection.

By default, every platform is enabled except **iOS, Android, Mac, Linux, browser, Steam VR, Meta Quest 2, Meta Quest 3, PSVR2, Evercade, visionOS, neogeomvs, neogeoaes, ZXS, Oculus Quest, Handheld, and Arduboy**. Newly discovered platforms use that same rule and are persisted when account preferences are next loaded. Existing choices survive platforms disappearing and returning. **All** enables all available platforms, including the default exclusions; unchecking everything shows no games. Search, reminders, emails, and calendar feeds are not platform-filtered.

## Popularity and refresh administration

Within each Calendar day/date-precision group and across Hot, games sort descending by **50% IGDB Want to Play + 50% IGDB Visits**, from [IGDB PopScore](https://api-docs.igdb.com/#popscore). Dates remain chronological, including month/quarter/year estimates. Ties use local reminders, hype, and deterministic date/name/ID ordering. Bell numbers still count only this application's local reminders, not IGDB users or all SSO accounts.

Missing metrics contribute zero. A successful zero-valued snapshot is cached, not repeatedly fetched. Missing snapshots are filled asynchronously at startup and after games are cached by sync/search. Full refreshes run daily at **07:00 Europe/Berlin**, including daylight-saving changes. One missed latest scheduled run is caught up at startup. Manual runs never move the next scheduled time.

`/reminders` includes a refresh widget **only** for users with the **`manage-realm` client role on `realm-management`** in Keycloak. It displays the current phase, committed/total games, a progressbar, last successful completion and next scheduled refresh, with Europe/Berlin timestamps. Admins can start a full refresh or cancel the active job. Requests run in batches in the background; the app remains usable and only sorting changes as batches finish. Completed batches survive cancellation/failure; unprocessed games retain their previous scores. Interrupted jobs are marked on restart. Status is persisted in SQLite, and IGDB errors are logged.

Admin roles come from the **access token returned directly by Keycloak during the server-side authorization-code exchange**, at `resource_access["realm-management"].roles`, following Multiworld and Reports. The ID token is validated by the OIDC library; the access token's issuer and subject must match that identity. No custom ID-token mapper or Terraform change is needed. Admin permission is stored in the session only until the access token expires; log in again to renew it. Existing sessions and users without that exact role see no widget and cannot call its start/status/cancel APIs. Ordinary login and reminders remain available after the admin permission expires.

## Data

Release dates, covers and trailers come from [IGDB](https://api-docs.igdb.com). Like on releases.com, releases dated only to a month, quarter or year appear as **tentative dates** after the last day of that period ("Nov 2026" after Nov 30, "Q4 2026" and then "2026" after Dec 31), marked with an "Est." label. Mails and calendar feeds only use exact days; TBD releases are left out. Every 6 hours the app syncs games releasing from 14 days ago to 180 days ahead, plus every tracked game. Release days are the UTC calendar days IGDB publishes.

releases.com is no longer used: it has no API and blocks automated clients with a Cloudflare challenge.

State (users, sessions, platform preferences, reminders, cached games and popularity, refresh progress) lives in SQLite at `DATA_DIR` (`/app/data`, the `data` volume, which is backed up). The app uses one process per SQLite data directory; background refresh coordination is process-local.

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
