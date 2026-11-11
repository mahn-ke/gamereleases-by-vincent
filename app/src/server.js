import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { safeReturnPath } from './auth.js';
import { buildCalendar } from './ics.js';
import { addDays, dayInZone, isDay } from './time.js';
import { calendarPage, hotPage, messagePage, remindersPage, searchPage } from './views.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SESSION_COOKIE = 'gr_session';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const CALENDAR_DAYS = 14;
const DEFAULT_PLATFORMS = ['PC', 'PlayStation 5', 'Xbox Series X', 'Switch', 'Switch 2', 'PlayStation 4', 'Xbox One', 'iOS', 'Android'];

function parseCookies(header = '') {
    const cookies = {};
    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index > 0) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    }
    return cookies;
}

function sameToken(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    return left.length === right.length && timingSafeEqual(left, right);
}

function platformsFrom(queryValue) {
    return [].concat(queryValue ?? []).filter(p => typeof p === 'string' && p.length <= 40).slice(0, 20);
}

export function createApp({ config, store, igdb, auth, log = console }) {
    const app = express();
    const secureCookies = config.baseUrl.startsWith('https://');
    app.disable('x-powered-by');
    app.set('trust proxy', true);

    app.use((req, res, next) => {
        res.set({
            'Content-Security-Policy': "default-src 'self'; img-src 'self' https://images.igdb.com data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'same-origin',
        });
        next();
    });
    app.use('/static', express.static(PUBLIC_DIR, { maxAge: '1h' }));
    app.use(express.json({ limit: '4kb' }));

    app.use((req, res, next) => {
        req.sessionId = parseCookies(req.headers.cookie)[SESSION_COOKIE] || null;
        req.user = store.getSessionUser(req.sessionId);
        next();
    });

    // State-changing requests must come from our own pages
    app.use((req, res, next) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
        if (req.get('origin') !== config.baseUrl) return res.status(403).type('text').send('Cross-origin request refused');
        next();
    });

    const context = (req, extra = {}) => {
        const today = dayInZone(new Date(), config.timeZone);
        const lastSync = store.getMeta('last_sync');
        const inUse = store.platformsInUse(addDays(today, -config.syncDaysBack));
        const allPlatforms = [...DEFAULT_PLATFORMS.filter(p => inUse.includes(p)), ...inUse.filter(p => !DEFAULT_PLATFORMS.includes(p))];
        return {
            user: req.user,
            today,
            from: today,
            path: req.originalUrl,
            basePath: req.path,
            platforms: platformsFrom(req.query.platform),
            allPlatforms: allPlatforms.length ? allPlatforms : DEFAULT_PLATFORMS,
            showFilters: true,
            syncNote: lastSync ? null : (igdb.configured ? 'The first sync with IGDB is still running' : 'IGDB is not configured yet'),
            ...extra,
        };
    };

    const requireUser = (req, res) => {
        if (req.user) return true;
        res.status(401).send(messagePage(context(req, { view: 'reminders', showFilters: false }), 'Log in required', 'Log in with your SSO account to manage reminders.', 401));
        return false;
    };

    app.get('/healthz', (req, res) => {
        res.json({ ok: true, lastSync: store.getMeta('last_sync'), igdb: igdb.configured, sso: auth.configured });
    });

    app.get('/', (req, res) => {
        const ctx = context(req, { view: 'calendar' });
        if (isDay(req.query.from)) ctx.from = req.query.from;
        const days = Math.min(62, Math.max(1, Number.parseInt(req.query.days, 10) || CALENDAR_DAYS));
        const releases = store.releasesBetween(ctx.from, addDays(ctx.from, days - 1), { userId: req.user?.id ?? null, platforms: ctx.platforms });
        res.send(calendarPage(ctx, releases, { days, showAll: req.query.all === '1' }));
    });

    app.get('/hot', (req, res) => {
        const ctx = context(req, { view: 'hot', title: 'Hot' });
        const releases = store.hotReleases(ctx.today, addDays(ctx.today, config.syncDaysAhead), { userId: req.user?.id ?? null, platforms: ctx.platforms });
        res.send(hotPage({ ...ctx, from: null }, releases));
    });

    app.get('/search', async (req, res) => {
        const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
        const ctx = context(req, { view: 'search', title: 'Search', showFilters: false, from: null });
        let ids = [];
        let error = null;
        if (q) {
            try {
                if (igdb.configured) {
                    const games = await igdb.search(q);
                    store.upsertGames(games);
                    ids = games.map(game => game.id);
                } else {
                    ids = store.searchLocal(q);
                }
            } catch (err) {
                log.error('Search failed:', err.message);
                error = 'Searching IGDB failed; showing games already known to this server.';
                ids = store.searchLocal(q);
            }
        }
        res.send(searchPage(ctx, store.gamesByIds(ids, req.user?.id ?? null, ctx.today), { q, error }));
    });

    app.get('/reminders', (req, res) => {
        if (!requireUser(req, res)) return;
        const ctx = context(req, { view: 'reminders', title: 'My reminders', showFilters: false, from: null });
        res.send(remindersPage(ctx, store.userReminders(req.user.id, ctx.today), {
            icsUrl: `${config.baseUrl}/${encodeURIComponent(req.user.username)}/${req.user.ics_token}.ics`,
        }));
    });

    app.post('/reminders/ics/regenerate', (req, res) => {
        if (!requireUser(req, res)) return;
        store.regenerateIcsToken(req.user.id);
        res.redirect(303, '/reminders');
    });

    app.post('/api/reminders/:gameId', (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Log in required' });
        const gameId = Number(req.params.gameId);
        if (!Number.isInteger(gameId) || !store.gameExists(gameId)) return res.status(404).json({ error: 'Unknown game' });
        const enabled = req.body?.enabled === true;
        const count = store.setReminder(req.user.id, gameId, enabled);
        res.json({ gameId, reminded: enabled, count });
    });

    app.get('/login', async (req, res, next) => {
        if (!auth.configured) return res.status(503).send(messagePage(context(req, { view: null, showFilters: false }), 'Login unavailable', 'SSO is not configured on this server.'));
        try {
            res.redirect(302, await auth.loginUrl(safeReturnPath(req.query.return)));
        } catch (error) {
            next(error);
        }
    });

    app.get('/auth/callback', async (req, res) => {
        try {
            const { user, idToken, returnTo } = await auth.complete(new URL(req.originalUrl, config.baseUrl));
            const sessionId = store.createSession(user.id, idToken, SESSION_TTL_SECONDS);
            res.cookie(SESSION_COOKIE, sessionId, { httpOnly: true, secure: secureCookies, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_SECONDS * 1000 });
            res.redirect(302, safeReturnPath(returnTo));
        } catch (error) {
            log.warn('Login failed:', error.message);
            res.status(400).send(messagePage(context(req, { view: null, showFilters: false }), 'Login failed', error.message, 401));
        }
    });

    app.post('/logout', (req, res) => {
        if (req.sessionId) store.deleteSession(req.sessionId);
        res.clearCookie(SESSION_COOKIE, { path: '/' });
        res.redirect(303, '/');
    });

    // Public, unauthenticated calendar feed: the secret token is the credential
    app.get('/:username/:token.ics', (req, res) => {
        const user = store.getUserByUsername(req.params.username);
        if (!user || !sameToken(user.ics_token, req.params.token)) return res.status(404).type('text').send('Not found');
        res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300', 'Referrer-Policy': 'no-referrer' });
        res.send(buildCalendar({ entries: store.userReleaseDays(user.id), username: user.username, baseUrl: config.baseUrl }));
    });

    app.use((req, res) => {
        res.status(404).send(messagePage(context(req, { view: null, showFilters: false }), 'Not found', 'This page does not exist.'));
    });

    // eslint-disable-next-line no-unused-vars
    app.use((error, req, res, next) => {
        log.error(error);
        res.status(500).send(messagePage(context(req, { view: null, showFilters: false }), 'Something went wrong', 'Please try again in a moment.'));
    });

    return app;
}
