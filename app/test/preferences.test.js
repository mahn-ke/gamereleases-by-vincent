import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db.js';
import { enabledByDefault } from '../src/platforms.js';
import { seededStore } from './helpers.js';

test('all requested default exclusions and aliases are disabled, other platforms enabled', () => {
    for (const platform of ['iOS', 'Android', 'Mac', 'Linux', 'browser', 'Steam VR', 'Meta Quest 2',
        'Meta Quest 3', 'PSVR2', 'Evercade', 'visionOS', 'neogeomvs', 'neogeoaes', 'ZXS',
        'Oculus Quest', 'Handheld', 'Arduboy', 'SteamVR', 'PlayStation VR2', 'Web browser']) {
        assert.equal(enabledByDefault(platform), false, platform);
    }
    for (const platform of ['PC', 'PlayStation 5', 'Xbox Series X', 'Switch 2', 'New console']) {
        assert.equal(enabledByDefault(platform), true, platform);
    }
});

test('preferences survive restart and disappearing platforms, initialize only new choices, and isolate users', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gamereleases-preferences-'));
    let store = openDatabase(dir);
    try {
        const alice = store.upsertUser({ sub: 'alice', username: 'alice' });
        const bob = store.upsertUser({ sub: 'bob', username: 'bob' });
        assert.deepEqual(store.platformPreferences(alice.id, ['PC', 'iOS']), ['PC']);
        store.savePlatformPreferences(alice.id, ['PC', 'iOS'], ['iOS']);
        store.close();
        store = openDatabase(dir);
        assert.deepEqual(store.platformPreferences(alice.id, ['iOS', 'New console', 'Android']), ['iOS', 'New console']);
        assert.deepEqual(store.platformPreferences(alice.id, ['PC', 'iOS']), ['iOS']);
        assert.deepEqual(store.platformPreferences(bob.id, ['PC', 'iOS']), ['PC']);
        assert.deepEqual(store.platformPreferences(null, ['PC', 'iOS']), ['PC']);
    } finally {
        store.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('combined score outranks hypes and local reminders without changing dates or precision grouping', () => {
    const { store, alice } = seededStore();
    try {
        store.upsertGames([
            { id: 20, name: 'Visits winner', hypes: 0, releases: [{ day: '2026-11-14', platform: 'PC' }] },
            { id: 21, name: 'Want runner up', hypes: 0, releases: [{ day: '2026-11-14', platform: 'PC' }] },
            { id: 22, name: 'Month winner', releases: [{ day: '2026-11-30', platform: 'PC', precision: 'month' }] },
        ]);
        store.setReminder(alice.id, 1, true);
        store.savePopularity([
            { id: 20, visits: .8, wantToPlay: .2 },
            { id: 21, visits: .1, wantToPlay: .7 },
            { id: 22, visits: .9, wantToPlay: .9 },
        ], '2026-11-10T00:00:00Z');
        const rows = store.releasesBetween('2026-11-14', '2026-11-30');
        assert.deepEqual(rows.slice(0, 3).map(g => g.id), [20, 21, 1]);
        assert.deepEqual(rows.filter(g => g.day === '2026-11-30').map(g => g.id), [22, 5]);
        assert.equal(store.hotReleases('2026-11-14', '2026-12-31')[0].id, 22);
        assert.deepEqual(store.releasesBetween('2026-11-14', '2026-12-31', { platforms: [] }), []);
        assert.deepEqual(store.hotReleases('2026-11-14', '2026-12-31', { platforms: [] }), []);
        assert.deepEqual(store.releasesBetween('2026-11-14', '2026-11-14', { platforms: ['PC'] }).map(g => g.id), [20, 21]);
        store.upsertGames([{ id: 20, name: 'Metadata refreshed', releases: [{ day: '2026-11-14', platform: 'PC' }] }]);
        assert.equal(store.releasesBetween('2026-11-14', '2026-11-14')[0].id, 20);
    } finally {
        store.close();
    }
});
