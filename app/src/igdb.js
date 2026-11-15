// IGDB (https://api-docs.igdb.com) via Twitch client credentials.
import { MONTHS, estimateAnchor, utcDay } from './time.js';
import { setTimeout as sleep } from 'node:timers/promises';

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const API_URL = 'https://api.igdb.com/v4';
const PAGE_SIZE = 500;
// IGDB allows 4 requests per second
const REQUEST_SPACING_MS = 300;

const GAME_FIELDS = [
    'name', 'slug', 'url', 'hypes', 'cover.image_id', 'artworks.image_id', 'screenshots.image_id', 'videos.video_id',
    'release_dates.*', 'release_dates.platform.name', 'release_dates.platform.abbreviation',
].join(',');

const PLATFORM_NAMES = new Map([
    ['PC (Microsoft Windows)', 'PC'],
    ['PlayStation 5', 'PlayStation 5'],
    ['Xbox Series X|S', 'Xbox Series X'],
    ['Nintendo Switch', 'Switch'],
    ['Nintendo Switch 2', 'Switch 2'],
    ['PlayStation 4', 'PlayStation 4'],
    ['Xbox One', 'Xbox One'],
    ['iOS', 'iOS'],
    ['Android', 'Android'],
    ['Mac', 'Mac'],
    ['Linux', 'Linux'],
]);

export function coverUrl(imageId, size = 't_cover_big') {
    return imageId ? `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg` : null;
}

// Date precision: IGDB renamed `category` to `date_format` (0 day, 1 month, 2 year,
// 3-6 quarters 1-4, 7 TBD). The `human` text ("Nov 14, 2026", "Nov 2026",
// "Q4 2026", "2026", "TBD") is the fallback and the source of the period.
// Returns { day, precision } with tentative dates anchored to their period's end.
export function releaseDay(release) {
    const code = release.date_format ?? release.category;
    const human = typeof release.human === 'string' ? release.human.trim() : '';
    const fallbackDate = typeof release.date === 'number' ? new Date(release.date * 1000) : null;
    const year = Number(release.y) || fallbackDate?.getUTCFullYear();
    let match;

    if (code === 0 || (code === undefined && /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(human))) {
        return fallbackDate ? { day: utcDay(release.date), precision: 'day' } : null;
    }
    if ((match = /^([A-Z][a-z]{2}) (\d{4})$/.exec(human)) && MONTHS.includes(match[1]) && (code === undefined || code === 1)) {
        return { day: estimateAnchor('month', Number(match[2]), MONTHS.indexOf(match[1]) + 1), precision: 'month' };
    }
    if ((match = /^Q([1-4]) (\d{4})$/.exec(human)) && (code === undefined || (code >= 3 && code <= 6))) {
        return { day: estimateAnchor('quarter', Number(match[2]), Number(match[1])), precision: 'quarter' };
    }
    if ((match = /^(\d{4})$/.exec(human)) && (code === undefined || code === 2)) {
        return { day: estimateAnchor('year', Number(match[1])), precision: 'year' };
    }
    if (!year) return null;
    // `human` missing or in an unexpected format: fall back to the numeric fields
    if (code === 1) return { day: estimateAnchor('month', year, Number(release.m) || fallbackDate.getUTCMonth() + 1), precision: 'month' };
    if (code >= 3 && code <= 6) return { day: estimateAnchor('quarter', year, code - 2), precision: 'quarter' };
    if (code === 2) return { day: estimateAnchor('year', year), precision: 'year' };
    return null;
}

function platformName(platform) {
    if (!platform || typeof platform !== 'object') return null;
    return PLATFORM_NAMES.get(platform.name) ?? platform.abbreviation ?? platform.name ?? null;
}

export function mapGame(raw) {
    const releases = [];
    const seen = new Set();
    for (const release of raw.release_dates ?? []) {
        if (typeof release !== 'object' || release === null) continue;
        const platform = platformName(release.platform);
        const when = platform ? releaseDay(release) : null;
        if (!when) continue;
        const key = `${when.day}|${platform}|${when.precision}`;
        if (seen.has(key)) continue;
        seen.add(key);
        releases.push({ day: when.day, platform, precision: when.precision });
    }
    return {
        id: raw.id,
        name: raw.name,
        slug: raw.slug ?? null,
        url: raw.url ?? null,
        hypes: raw.hypes ?? 0,
        coverImageId: raw.cover?.image_id ?? null,
        artImageId: raw.artworks?.[0]?.image_id ?? raw.screenshots?.[0]?.image_id ?? null,
        videoId: raw.videos?.[0]?.video_id ?? null,
        releases,
    };
}

function quote(text) {
    return `"${String(text).replace(/["\\]/g, ' ')}"`;
}

export class IgdbClient {
    constructor({ clientId, clientSecret, fetch = globalThis.fetch, sleep: wait = (ms, signal) => sleep(ms, undefined, { signal }) }) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.fetch = fetch;
        this.sleep = wait;
        this.token = null;
        this.tokenExpiresAt = 0;
        this.lastRequestAt = 0;
        this.admission = Promise.resolve();
    }

    get configured() {
        return Boolean(this.clientId && this.clientSecret);
    }

    async accessToken(force = false, signal) {
        if (!force && this.token && Date.now() < this.tokenExpiresAt) return this.token;
        const params = new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, grant_type: 'client_credentials' });
        const response = await this.fetch(`${TOKEN_URL}?${params}`, { method: 'POST', signal });
        if (!response.ok) throw new Error(`Twitch token request failed with HTTP ${response.status}`);
        const body = await response.json();
        this.token = body.access_token;
        this.tokenExpiresAt = Date.now() + Math.max(0, (body.expires_in ?? 0) - 60) * 1000;
        return this.token;
    }

    async admit(signal) {
        const turn = this.admission.then(async () => {
            signal?.throwIfAborted();
            const wait = this.lastRequestAt + REQUEST_SPACING_MS - Date.now();
            if (wait > 0) await this.sleep(wait, signal);
            signal?.throwIfAborted();
            this.lastRequestAt = Date.now();
        });
        // A canceled waiter must not poison admission for unrelated requests.
        this.admission = turn.catch(() => {});
        await turn;
    }

    async query(endpoint, body, retried = false, signal) {
        if (!this.configured) throw new Error('IGDB is not configured (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET)');
        const token = await this.accessToken(retried, signal);
        await this.admit(signal);
        const response = await this.fetch(`${API_URL}/${endpoint}`, {
            method: 'POST',
            signal,
            headers: { 'Client-ID': this.clientId, Authorization: `Bearer ${token}`, Accept: 'application/json' },
            body,
        });
        if (response.status === 401 && !retried) return this.query(endpoint, body, true, signal);
        if (response.status === 429 && !retried) {
            await this.sleep(1000, signal);
            return this.query(endpoint, body, true, signal);
        }
        if (!response.ok) throw new Error(`IGDB ${endpoint} failed with HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
        return response.json();
    }

    async popularityByIds(ids, signal) {
        const scores = new Map(ids.map(id => [id, { id, visits: 0, wantToPlay: 0 }]));
        for (let i = 0; i < ids.length; i += PAGE_SIZE) {
            const chunk = ids.slice(i, i + PAGE_SIZE);
            const seen = new Set();
            for (let offset = 0; ; offset += PAGE_SIZE) {
                const page = await this.query('popularity_primitives',
                    `fields game_id,popularity_type,value; where game_id = (${chunk.join(',')}) & popularity_type = (1,2); sort id asc; limit ${PAGE_SIZE}; offset ${offset};`, false, signal);
                if (!Array.isArray(page)) throw new Error('Invalid IGDB popularity response');
                for (const row of page) {
                    if (!row || !chunk.includes(row.game_id) || ![1, 2].includes(row.popularity_type)
                        || typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value < 0
                        || seen.has(`${row.game_id}:${row.popularity_type}`)) throw new Error('Invalid IGDB popularity primitive');
                    seen.add(`${row.game_id}:${row.popularity_type}`);
                    scores.get(row.game_id)[row.popularity_type === 1 ? 'visits' : 'wantToPlay'] = row.value;
                }
                if (page.length < PAGE_SIZE) break;
            }
        }
        signal?.throwIfAborted();
        return [...scores.values()];
    }

    // Games with at least one release date inside [fromUnix, toUnix)
    async gamesReleasingBetween(fromUnix, toUnix) {
        const games = [];
        for (let offset = 0; ; offset += PAGE_SIZE) {
            const page = await this.query('games',
                `fields ${GAME_FIELDS}; where release_dates.date >= ${fromUnix} & release_dates.date < ${toUnix}; sort id asc; limit ${PAGE_SIZE}; offset ${offset};`);
            games.push(...page.map(mapGame));
            if (page.length < PAGE_SIZE) return games;
        }
    }

    async gamesByIds(ids) {
        const games = [];
        for (let i = 0; i < ids.length; i += PAGE_SIZE) {
            const chunk = ids.slice(i, i + PAGE_SIZE).map(Number).filter(Number.isInteger);
            if (!chunk.length) continue;
            const page = await this.query('games', `fields ${GAME_FIELDS}; where id = (${chunk.join(',')}); limit ${PAGE_SIZE};`);
            games.push(...page.map(mapGame));
        }
        return games;
    }

    async search(text) {
        const page = await this.query('games', `search ${quote(text)}; fields ${GAME_FIELDS}; limit 40;`);
        return page.map(mapGame);
    }
}
