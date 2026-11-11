import { openDatabase } from '../src/db.js';
import { loadConfig } from '../src/config.js';

export function testConfig(overrides = {}) {
    return {
        ...loadConfig({ APP_BASE_URL: 'https://gamereleases.example.test', SMTP_HOST: 'smtp.example.test', SMTP_FROM: 'releases@example.test' }),
        ...overrides,
    };
}

export function seededStore() {
    const store = openDatabase(':memory:');
    store.upsertGames([
        { id: 1, name: 'Ova Magica', url: 'https://www.igdb.com/games/ova-magica', hypes: 30, coverImageId: 'co1', artImageId: 'sc1', videoId: 'vid1',
            releases: [{ day: '2026-11-14', platform: 'PlayStation 5' }, { day: '2026-11-14', platform: 'Xbox Series X' }] },
        { id: 2, name: 'Warhammer Survivors', url: 'https://www.igdb.com/games/warhammer-survivors', hypes: 20, coverImageId: 'co2',
            releases: [{ day: '2026-11-14', platform: 'Switch' }, { day: '2026-12-01', platform: 'PC' }] },
        { id: 3, name: '<script>alert(1)</script> Remastered', hypes: 0, releases: [{ day: '2026-11-15', platform: 'Switch' }] },
        { id: 4, name: 'Unannounced Sequel', hypes: 2, releases: [] },
        { id: 5, name: 'Starfall Saga', hypes: 50, coverImageId: 'co5', artImageId: 'sc5',
            releases: [{ day: '2026-11-30', platform: 'PC', precision: 'month' }, { day: '2026-11-30', platform: 'PlayStation 5', precision: 'month' }] },
        { id: 6, name: 'Harbor Lights', hypes: 1, releases: [{ day: '2026-12-31', platform: 'Switch', precision: 'quarter' }] },
        { id: 7, name: 'Someday Odyssey', hypes: 9, releases: [{ day: '2026-12-31', platform: 'PC', precision: 'year' }] },
        { id: 8, name: 'Year End Exact', hypes: 0, releases: [{ day: '2026-12-31', platform: 'PC' }] },
    ]);
    const alice = store.upsertUser({ sub: 'sub-alice', username: 'alice', email: 'alice@example.test', name: 'Alice Example' });
    const bob = store.upsertUser({ sub: 'sub-bob', username: 'bob', email: 'bob@example.test', name: 'Bob Example' });
    return { store, alice, bob };
}
