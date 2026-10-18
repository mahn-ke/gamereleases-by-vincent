# gamereleases.by.vincent.mahn.ke

Hosts the container generating the calendar file at [gamereleases.by.vincent.mahn.ke/releases.ics](https://gamereleases.by.vincent.mahn.ke/releases.ics).

releases.com allows users to watch media release dates and sends emails when they change or occur. This script reads the logged-in user's tracked releases (`/calendar/tracking`, grouped by exact date) every 5 minutes and exposes them as an `.ics` file that calendar clients can subscribe to. Releases that only have an estimated date (quarter/year) are skipped.

releases.com has no public or mobile API and is behind Cloudflare bot protection, so requests are sent with a Chrome TLS fingerprint via [impit](https://github.com/apify/impit).

## Authentication

Configure at least one of:

| Variable | Description |
| --- | --- |
| `RELEASES_EMAIL` / `RELEASES_PASSWORD` | Email/password login; used to log in automatically whenever the session is missing or expired. Accounts created via Google/Apple sign-in can set a password via "Forgot password?" on the login page. |
| `RELEASES_COOKIE` | Value of the `.AspNetCore.Cookies` cookie from a logged-in browser session (valid for ~14 days). |

Renewed session cookies are persisted to `DATA_DIR` (`/app/data`, a docker volume) and take precedence over `RELEASES_COOKIE`.
