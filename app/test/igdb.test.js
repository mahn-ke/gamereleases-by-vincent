import test from 'node:test';
import assert from 'node:assert/strict';
import { IgdbClient, coverUrl, mapGame } from '../src/igdb.js';

const NOV14 = Date.UTC(2026, 10, 14) / 1000;
const NOV20 = Date.UTC(2026, 10, 20) / 1000;

test('mapGame keeps exact-day releases with readable platform names', () => {
    const game = mapGame({
        id: 1, name: 'Example Quest', slug: 'example-quest', url: 'https://www.igdb.com/games/example-quest', hypes: 12,
        cover: { image_id: 'co1' }, screenshots: [{ image_id: 'sc1' }], videos: [{ video_id: 'abc' }],
        release_dates: [
            { date: NOV14, date_format: 0, platform: { name: 'PlayStation 5', abbreviation: 'PS5' } },
            { date: NOV14, date_format: 0, platform: { name: 'Xbox Series X|S', abbreviation: 'Series X|S' } },
            { date: NOV14 + 3600, date_format: 0, platform: { name: 'PlayStation 5' } }, // duplicate region
            { date: NOV20, category: 0, platform: { name: 'PC (Microsoft Windows)', abbreviation: 'PC' } },
            { date: NOV20, human: 'Nov 20, 2026', platform: { name: 'Nintendo Switch 2' } },
            { date: NOV20, date_format: 2, human: '2026', platform: { name: 'Nintendo Switch' } },
            { date: NOV20, human: 'Q4 2026', platform: { name: 'Android' } },
            { date: NOV20, date_format: 0, platform: 34 },
            { human: 'TBD', platform: { name: 'iOS' } },
        ],
    });
    assert.deepEqual(game.releases, [
        { day: '2026-11-14', platform: 'PlayStation 5' },
        { day: '2026-11-14', platform: 'Xbox Series X' },
        { day: '2026-11-20', platform: 'PC' },
        { day: '2026-11-20', platform: 'Switch 2' },
    ]);
    assert.equal(game.coverImageId, 'co1');
    assert.equal(game.artImageId, 'sc1');
    assert.equal(game.videoId, 'abc');
    assert.equal(game.hypes, 12);
    assert.equal(coverUrl('co1'), 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg');
    assert.equal(coverUrl(null), null);
});

function fakeFetch(handler) {
    const calls = [];
    const fn = async (url, options = {}) => {
        calls.push({ url: String(url), options });
        const { status = 200, body } = handler(String(url), options, calls) ?? {};
        return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) };
    };
    fn.calls = calls;
    return fn;
}

test('IgdbClient authenticates once, paginates and sends Apicalypse queries', async () => {
    const pages = [Array.from({ length: 500 }, (_, i) => ({ id: i + 1, name: `Game ${i + 1}` })), [{ id: 501, name: 'Last' }]];
    const fetch = fakeFetch((url) => {
        if (url.startsWith('https://id.twitch.tv')) return { body: { access_token: 'tok', expires_in: 3600 } };
        return { body: pages.shift() };
    });
    const client = new IgdbClient({ clientId: 'cid', clientSecret: 'secret', fetch, sleep: async () => {} });
    const games = await client.gamesReleasingBetween(100, 200);
    assert.equal(games.length, 501);
    const tokenCalls = fetch.calls.filter(c => c.url.startsWith('https://id.twitch.tv'));
    assert.equal(tokenCalls.length, 1);
    assert.match(tokenCalls[0].url, /grant_type=client_credentials/);
    const apiCalls = fetch.calls.filter(c => c.url === 'https://api.igdb.com/v4/games');
    assert.equal(apiCalls.length, 2);
    assert.equal(apiCalls[0].options.headers['Client-ID'], 'cid');
    assert.equal(apiCalls[0].options.headers.Authorization, 'Bearer tok');
    assert.match(apiCalls[0].options.body, /where release_dates\.date >= 100 & release_dates\.date < 200;/);
    assert.match(apiCalls[1].options.body, /offset 500;/);
});

test('IgdbClient refreshes an expired token once on 401', async () => {
    let tokens = 0;
    let apiCalls = 0;
    const fetch = fakeFetch((url) => {
        if (url.startsWith('https://id.twitch.tv')) return { body: { access_token: `tok${++tokens}`, expires_in: 3600 } };
        apiCalls++;
        return apiCalls === 1 ? { status: 401, body: {} } : { body: [{ id: 7, name: 'Seven' }] };
    });
    const client = new IgdbClient({ clientId: 'cid', clientSecret: 'secret', fetch, sleep: async () => {} });
    const games = await client.gamesByIds([7]);
    assert.equal(games[0].name, 'Seven');
    assert.equal(tokens, 2);
});

test('IgdbClient search neutralises quotes and reports errors', async () => {
    const fetch = fakeFetch((url, options) => {
        if (url.startsWith('https://id.twitch.tv')) return { body: { access_token: 'tok', expires_in: 3600 } };
        assert.match(options.body, /^search "a  b"; fields /);
        return { status: 400, body: { message: 'bad' } };
    });
    const client = new IgdbClient({ clientId: 'cid', clientSecret: 'secret', fetch, sleep: async () => {} });
    await assert.rejects(client.search('a"\\b'), /IGDB games failed with HTTP 400/);
    assert.equal(new IgdbClient({}).configured, false);
});
