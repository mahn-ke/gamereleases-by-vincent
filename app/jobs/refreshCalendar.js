import * as cheerio from 'cheerio';
import ical from 'ical-generator';
import { Impit } from 'impit';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';

const BASE_URL = 'https://www.releases.com';
const AUTH_COOKIE = '.AspNetCore.Cookies';
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const SESSION_FILE = path.join(DATA_DIR, 'session.json');
const OUTPUT_FILE = path.join(process.cwd(), 'releases.ics');
const MAX_GROUPS = 500;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// releases.com sits behind Cloudflare bot management, which rejects non-browser TLS fingerprints
const impit = new Impit({ browser: 'chrome' });

function loadSessionCookie() {
    if (existsSync(SESSION_FILE)) {
        try {
            const { cookie } = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
            if (cookie) return cookie;
        } catch (error) {
            console.warn('Ignoring unreadable session file:', error.message);
        }
    }
    return process.env.RELEASES_COOKIE || null;
}

function saveSessionCookie(cookie) {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(SESSION_FILE, JSON.stringify({ cookie, updatedAt: new Date().toISOString() }), { mode: 0o600 });
}

class ReleasesClient {
    constructor(cookie) {
        this.cookie = cookie;
    }

    async request(urlPath, options = {}) {
        const headers = { 'X-Requested-With': 'XMLHttpRequest', ...options.headers };
        if (this.cookie) headers.Cookie = `${AUTH_COOKIE}=${this.cookie}`;
        const response = await impit.fetch(BASE_URL + urlPath, { ...options, headers });
        this.captureRenewedCookie(response);
        const text = await response.text();
        if (!response.ok) {
            throw new Error(`${options.method || 'GET'} ${urlPath} failed with HTTP ${response.status}`);
        }
        return text;
    }

    // ASP.NET Core sliding expiration re-issues the auth cookie; persisting it keeps the session alive
    captureRenewedCookie(response) {
        const setCookie = response.headers.get('set-cookie') || '';
        const match = setCookie.match(new RegExp(`${AUTH_COOKIE.replace(/\./g, '\\.')}=([^;,\\s]+)`));
        if (match && match[1] !== this.cookie) {
            this.cookie = match[1];
            saveSessionCookie(this.cookie);
            console.log('Stored renewed session cookie');
        }
    }

    async isLoggedIn() {
        if (!this.cookie) return false;
        const $ = cheerio.load(await this.request('/calendar/tracking'));
        return !!$('[data-metuserid]').attr('data-metuserid');
    }

    async login(email, password) {
        this.cookie = null;
        const body = new URLSearchParams({ Email: email, Password: password }).toString();
        const result = JSON.parse(await this.request('/partial/Releases.Core.BL.Accounts.CookieLogin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body
        }));
        if (!result.Success || !this.cookie) {
            const reason = (result.Errors || []).map(e => e.Value).join(', ') || 'no session cookie returned';
            throw new Error(`Login failed: ${reason}`);
        }
        console.log('Logged in with RELEASES_EMAIL/RELEASES_PASSWORD');
    }

    async fetchGroup(code) {
        const query = new URLSearchParams({
            Code: code,
            Category: 'tracking',
            Section: 'Calendar',
            Interval: 'Dates',
            Direction: 'Forward',
            GroupMode: 'Feed'
        });
        return this.request(`/partial/Releases.Www.PL.Calendar.Group?${query}`);
    }
}

async function authenticate() {
    const client = new ReleasesClient(loadSessionCookie());
    if (await client.isLoggedIn()) return client;

    const { RELEASES_EMAIL: email, RELEASES_PASSWORD: password } = process.env;
    if (!email || !password) {
        throw new Error('Not logged in to releases.com: RELEASES_COOKIE is missing or expired and RELEASES_EMAIL/RELEASES_PASSWORD are not set');
    }
    await client.login(email, password);
    if (!(await client.isLoggedIn())) throw new Error('Login succeeded but session is not authenticated');
    saveSessionCookie(client.cookie);
    return client;
}

// data-calendarcode is e.g. "2026-oct-22" for exact dates; estimates look like "2026-q4-est" or "2026-est"
function parseCalendarCode(calendarCode) {
    const match = /^(\d{4})-([a-z]{3})-(\d{1,2})$/.exec(calendarCode || '');
    if (!match) return null;
    const month = MONTHS.indexOf(match[2]);
    if (month < 0) return null;
    return new Date(Date.UTC(Number(match[1]), month, Number(match[3])));
}

function parseGroup(html) {
    const $ = cheerio.load(html);
    const releases = [];
    $('.RWP-Calendar-Group').each((_, group) => {
        const calendarCode = $(group).attr('data-calendarcode');
        const date = parseCalendarCode(calendarCode);
        $(group).find('.RWPCC-CalendarItems-CardControl').each((_, card) => {
            const nameEl = $(card).find('a.RWPCC-CalendarItems-CardControl-Name');
            const name = nameEl.text().trim();
            if (!name) return;
            const versions = $(card).find('.RWPCC-CalendarItems-TypeAndVersionsControl-Version')
                .map((_, v) => $(v).clone().children('.RWPCC-CalendarItems-TypeAndVersionsControl-Divider').remove().end().text().trim())
                .get()
                .filter(Boolean);
            releases.push({ name, versions, href: nameEl.attr('href'), date, estimate: date ? null : calendarCode });
        });
    });
    const nextUrl = $('.RWPCC-InfinityDown-InfinityDownControl[data-ui-url]').last().attr('data-ui-url');
    const nextCode = nextUrl ? new URLSearchParams(nextUrl.split('?')[1]).get('Code') : null;
    return { releases, nextCode };
}

async function fetchUpcomingReleases(client) {
    const today = new Date();
    let code = `Y${today.getUTCFullYear()}-M${today.getUTCMonth() + 1}-D${today.getUTCDate()}`;
    const seenCodes = new Set();
    const releases = [];
    while (code && !seenCodes.has(code) && seenCodes.size < MAX_GROUPS) {
        seenCodes.add(code);
        const group = parseGroup(await client.fetchGroup(code));
        releases.push(...group.releases);
        code = group.nextCode;
    }
    return releases;
}

const refreshCalendar = async () => {
    const client = await authenticate();
    const releases = await fetchUpcomingReleases(client);

    const cal = ical({ name: 'Releases.com Calendar' });
    for (const release of releases) {
        if (!release.date) {
            console.log(`Skipping ${release.name}: no exact date (${release.estimate})`);
            continue;
        }
        const slug = release.href?.replace(/^\/p\//, '') || release.name;
        const day = release.date.toISOString().slice(0, 10);
        cal.createEvent({
            id: `${slug}-${day}@releases.com`,
            start: release.date,
            allDay: true,
            summary: release.versions.length ? `${release.name} (${release.versions.join(' / ')})` : release.name,
            url: release.href ? BASE_URL + release.href : undefined
        });
        console.log(`${day}: ${release.name}`);
    }

    const tmpFile = `${OUTPUT_FILE}.tmp`;
    writeFileSync(tmpFile, cal.toString());
    renameSync(tmpFile, OUTPUT_FILE);
    console.log(`iCal file generated: ${OUTPUT_FILE} (${cal.events().length} events)`);
};

refreshCalendar().catch((error) => {
    console.error(error);
    process.exit(1);
});
