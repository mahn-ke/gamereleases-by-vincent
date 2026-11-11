import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/server.js';
import { safeReturnPath, usernameFromClaims } from '../src/auth.js';
import { seededStore, testConfig } from './helpers.js';

const quiet = { info() {}, warn() {}, error() {} };
const ORIGIN = 'https://gamereleases.example.test';

async function startServer({ igdb = { configured: false }, auth = { configured: false } } = {}) {
    const { store, alice, bob } = seededStore();
    store.setMeta('last_sync', new Date().toISOString());
    const app = createApp({ config: testConfig(), store, igdb, auth, log: quiet });
    const server = app.listen(0);
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = user => `gr_session=${store.createSession(user.id, null, 3600)}`;
    const request = (path, { cookie, origin, method = 'GET', json } = {}) => fetch(base + path, {
        method,
        redirect: 'manual',
        headers: {
            ...(cookie ? { cookie } : {}),
            ...(origin ? { origin } : {}),
            ...(json ? { 'content-type': 'application/json' } : {}),
        },
        body: json ? JSON.stringify(json) : undefined,
    });
    return { store, alice, bob, server, request, session };
}

test('calendar lists releases from the requested day with escaped names', async (t) => {
    const ctx = await startServer();
    t.after(() => ctx.server.close());
    const page = await (await ctx.request('/?from=2026-11-14')).text();
    assert.match(page, /Ova Magica/);
    assert.match(page, /PlayStation 5 \/ Xbox Series X/);
    assert.match(page, /https:\/\/images\.igdb\.com\/igdb\/image\/upload\/t_cover_big\/co1\.jpg/);
    assert.match(page, /youtube\.com\/watch\?v=vid1/);
    assert.match(page, /class="card wide"/); // anticipated with artwork
    assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt; Remastered/);
    assert.doesNotMatch(page, /<script>alert/);
    assert.match(page, /href="\/login\?return=/); // logged-out bells link to login

    const filtered = await (await ctx.request('/?from=2026-11-14&platform=Switch')).text();
    assert.doesNotMatch(filtered, /Ova Magica/);
    assert.match(filtered, /Warhammer Survivors/);

    const headers = (await ctx.request('/')).headers;
    assert.match(headers.get('content-security-policy'), /script-src 'self'/);
});

test('reminders require a session and a same-origin request', async (t) => {
    const ctx = await startServer();
    t.after(() => ctx.server.close());
    const cookie = ctx.session(ctx.alice);

    assert.equal((await ctx.request('/api/reminders/1', { method: 'POST', origin: ORIGIN, json: { enabled: true } })).status, 401);
    assert.equal((await ctx.request('/api/reminders/1', { method: 'POST', cookie, json: { enabled: true } })).status, 403);
    assert.equal((await ctx.request('/api/reminders/1', { method: 'POST', cookie, origin: 'https://evil.test', json: { enabled: true } })).status, 403);
    assert.equal((await ctx.request('/api/reminders/999', { method: 'POST', cookie, origin: ORIGIN, json: { enabled: true } })).status, 404);

    const on = await ctx.request('/api/reminders/1', { method: 'POST', cookie, origin: ORIGIN, json: { enabled: true } });
    assert.deepEqual(await on.json(), { gameId: 1, reminded: true, count: 1 });
    await ctx.request('/api/reminders/1', { method: 'POST', cookie: ctx.session(ctx.bob), origin: ORIGIN, json: { enabled: true } });

    const page = await (await ctx.request('/?from=2026-11-14', { cookie })).text();
    assert.match(page, /class="bell on" data-game="1"[^>]*>.*?<span>2<\/span>/s);

    const reminders = await (await ctx.request('/reminders', { cookie })).text();
    assert.match(reminders, /Ova Magica/);
    assert.match(reminders, /alice@example\.test/);

    const off = await ctx.request('/api/reminders/1', { method: 'POST', cookie, origin: ORIGIN, json: { enabled: false } });
    assert.deepEqual(await off.json(), { gameId: 1, reminded: false, count: 1 });
    assert.equal((await ctx.request('/reminders')).status, 401);
});

test('ICS feed is public with the secret, refreshes, and can be rotated', async (t) => {
    const ctx = await startServer();
    t.after(() => ctx.server.close());
    ctx.store.setReminder(ctx.alice.id, 1, true);
    ctx.store.setReminder(ctx.alice.id, 2, true);
    ctx.store.setReminder(ctx.bob.id, 3, true);
    const token = ctx.store.getUserByUsername('alice').ics_token;

    const response = await ctx.request(`/alice/${token}.ics`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/calendar/);
    const body = await response.text();
    assert.match(body, /BEGIN:VCALENDAR/);
    assert.match(body, /REFRESH-INTERVAL;VALUE=DURATION:PT6H/);
    assert.match(body, /DTSTART;VALUE=DATE:20261114/);
    assert.match(body, /DTSTART;VALUE=DATE:20261201/);
    assert.match(body, /SUMMARY:Ova Magica \(PlayStation 5 \/ Xbox Series X\)/);
    assert.match(body, /UID:1-2026-11-14@gamereleases\.example\.test/);
    assert.doesNotMatch(body, /Remastered/); // Bob's reminder

    assert.equal((await ctx.request(`/alice/${token}x.ics`)).status, 404);
    assert.equal((await ctx.request(`/bob/${token}.ics`)).status, 404);
    assert.equal((await ctx.request(`/nobody/${token}.ics`)).status, 404);

    const cookie = ctx.session(ctx.alice);
    assert.equal((await ctx.request('/reminders/ics/regenerate', { method: 'POST', cookie })).status, 403);
    const rotated = await ctx.request('/reminders/ics/regenerate', { method: 'POST', cookie, origin: ORIGIN });
    assert.equal(rotated.status, 303);
    assert.equal((await ctx.request(`/alice/${token}.ics`)).status, 404);
    const newToken = ctx.store.getUserByUsername('alice').ics_token;
    assert.notEqual(newToken, token);
    assert.equal((await ctx.request(`/alice/${newToken}.ics`)).status, 200);
    const reminders = await (await ctx.request('/reminders', { cookie })).text();
    assert.ok(reminders.includes(`https://gamereleases.example.test/alice/${newToken}.ics`));
});

test('login redirects to the provider and the callback creates a session', async (t) => {
    let completedWith = null;
    const auth = {
        configured: true,
        async loginUrl(returnTo) { return `https://sso.example.test/auth?return=${encodeURIComponent(returnTo)}`; },
        async complete(url) {
            completedWith = url;
            return { user: ctx.alice, idToken: 'id', returnTo: '/hot' };
        },
    };
    const ctx = await startServer({ auth });
    t.after(() => ctx.server.close());

    const login = await ctx.request('/login?return=//evil.test');
    assert.equal(login.status, 302);
    assert.equal(login.headers.get('location'), 'https://sso.example.test/auth?return=%2F');

    const callback = await ctx.request('/auth/callback?code=abc&state=xyz');
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), '/hot');
    assert.equal(completedWith.href, 'https://gamereleases.example.test/auth/callback?code=abc&state=xyz');
    const cookie = callback.headers.get('set-cookie');
    assert.match(cookie, /gr_session=[\w-]+;.*HttpOnly.*Secure.*SameSite=Lax/i);
    const page = await (await ctx.request('/reminders', { cookie: cookie.split(';')[0] })).text();
    assert.match(page, /Calendar subscription/);

    const logout = await ctx.request('/logout', { method: 'POST', cookie: cookie.split(';')[0], origin: ORIGIN });
    assert.equal(logout.status, 303);
    assert.equal((await ctx.request('/reminders', { cookie: cookie.split(';')[0] })).status, 401);
});

test('search uses IGDB and falls back to known games', async (t) => {
    const igdb = {
        configured: true,
        async search(q) {
            if (q === 'broken') throw new Error('IGDB down');
            return [{ id: 50, name: 'Hope in the City', hypes: 1, releases: [{ day: '2027-01-05', platform: 'PC' }] }];
        },
    };
    const ctx = await startServer({ igdb });
    t.after(() => ctx.server.close());
    const found = await (await ctx.request('/search?q=hope')).text();
    assert.match(found, /Hope in the City/);
    assert.ok(ctx.store.gameExists(50));
    const fallback = await (await ctx.request('/search?q=broken')).text();
    assert.match(fallback, /Searching IGDB failed/);
    const health = await (await ctx.request('/healthz')).json();
    assert.equal(health.ok, true);
    assert.equal(health.igdb, true);
});

test('auth helpers keep redirects local and usernames URL-safe', () => {
    assert.equal(safeReturnPath('/reminders?x=1'), '/reminders?x=1');
    assert.equal(safeReturnPath('//evil.test'), '/');
    assert.equal(safeReturnPath('https://evil.test'), '/');
    assert.equal(safeReturnPath('/\\evil.test'), '/');
    assert.equal(usernameFromClaims({ preferred_username: 'Vincent Example', sub: 'x' }), 'vincent-example');
    assert.equal(usernameFromClaims({ email: 'first.last@example.test', sub: 'x' }), 'first.last');
    assert.equal(usernameFromClaims({ preferred_username: '../..', sub: '' }), 'user');
    const { store } = seededStore();
    const clash = store.upsertUser({ sub: 'sub-other-alice', username: 'alice', email: null });
    assert.equal(clash.username, 'alice-2');
    const again = store.upsertUser({ sub: 'sub-alice', username: 'renamed', email: 'new@example.test' });
    assert.equal(again.username, 'alice');
    assert.equal(again.email, 'new@example.test');
});

test('tentative releases follow the end of their period, grouped and labelled', async (t) => {
    const ctx = await startServer();
    t.after(() => ctx.server.close());
    const page = await (await ctx.request('/?from=2026-11-25&days=40')).text();
    const order = ['Monday, Nov 30', 'Starfall Saga', 'Thursday, Dec 31', 'Year End Exact', 'Est. Q4', 'Harbor Lights', 'Est. 2026', 'Someday Odyssey']
        .map(text => page.indexOf(text));
    assert.ok(order.every(i => i >= 0), `missing: ${order}`);
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'exact first, then quarter, then year');
    assert.match(page, /Tentative dates<\/span><span class="chip">Est\. Nov<\/span>/);
    assert.match(page, /class="when est"[^>]*>.*?<span>Est\. Nov 2026<\/span>/s);
    assert.doesNotMatch(page, /class="card wide"[^>]*>(?:(?!<\/article>).)*Starfall Saga/s, 'tentative games are never featured');

    const hot = await (await ctx.request('/hot')).text();
    assert.match(hot, /Starfall Saga/);

    const search = ctx.store.gamesByIds([7, 2], null, '2026-11-20');
    assert.deepEqual(search.map(g => [g.id, g.day, g.precision]), [[7, '2026-12-31', 'year'], [2, '2026-12-01', 'day']]);
});

test('reminders, ICS and mails treat tentative dates as tentative', async (t) => {
    const ctx = await startServer();
    t.after(() => ctx.server.close());
    ctx.store.setReminder(ctx.alice.id, 5, true);
    ctx.store.setReminder(ctx.alice.id, 1, true);
    const cookie = ctx.session(ctx.alice);
    const reminders = await (await ctx.request('/reminders', { cookie })).text();
    assert.match(reminders, /Est\. Nov 2026/);

    const token = ctx.store.getUserByUsername('alice').ics_token;
    const ics = await (await ctx.request(`/alice/${token}.ics`)).text();
    assert.match(ics, /Ova Magica/);
    assert.doesNotMatch(ics, /Starfall Saga/);
    assert.deepEqual(ctx.store.pendingNotifications('2026-11-30'), []);
});

test('an old releases cache without precision is rebuilt', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const { DatabaseSync } = await import('node:sqlite');
    const { openDatabase } = await import('../src/db.js');
    const dir = mkdtempSync(path.join(tmpdir(), 'gamereleases-'));
    try {
        const old = new DatabaseSync(path.join(dir, 'gamereleases.sqlite'));
        old.exec('create table releases (game_id integer not null, day text not null, platform text not null, primary key (game_id, day, platform));');
        old.exec("insert into releases values (1, '2026-11-14', 'PC')");
        old.close();
        const store = openDatabase(dir);
        store.upsertGames([{ id: 1, name: 'Rebuilt', releases: [{ day: '2026-11-30', platform: 'PC', precision: 'month' }] }]);
        assert.deepEqual(store.releasesBetween('2026-11-01', '2026-12-01').map(r => [r.name, r.precision]), [['Rebuilt', 'month']]);
        store.close();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
