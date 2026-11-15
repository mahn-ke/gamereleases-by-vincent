import test from 'node:test';
import assert from 'node:assert/strict';
import { PopScore } from '../src/popscore.js';
import { dailyRefreshTimes, timestampInZone } from '../src/time.js';
import { seededStore } from './helpers.js';

const quiet = { error() {} };
const values = ids => ids.map(id => ({ id, visits: 0, wantToPlay: 0 }));
const turn = () => new Promise(resolve => setImmediate(resolve));

test('daily schedule remains at 07:00 Berlin across both DST transitions', () => {
    for (const [instant, latest, next] of [
        ['2026-03-28T07:00:00Z', '2026-03-28T06:00:00.000Z', '2026-03-29T05:00:00.000Z'],
        ['2026-03-29T04:59:59Z', '2026-03-28T06:00:00.000Z', '2026-03-29T05:00:00.000Z'],
        ['2026-10-24T06:00:00Z', '2026-10-24T05:00:00.000Z', '2026-10-25T06:00:00.000Z'],
        ['2026-10-25T06:00:00Z', '2026-10-25T06:00:00.000Z', '2026-10-26T06:00:00.000Z'],
    ]) {
        const times = dailyRefreshTimes(new Date(instant), 'Europe/Berlin');
        assert.equal(times.latest.toISOString(), latest);
        assert.equal(times.next.toISOString(), next);
    }
    assert.equal(timestampInZone('2026-12-21T14:12:23Z', 'Europe/Berlin'), '2026/12/21 15:12:23 Europe/Berlin');
});

test('cold batches skip valid zero snapshots and pick up newly cached games', async () => {
    const { store } = seededStore();
    const calls = [];
    const igdb = { configured: true, async popularityByIds(ids) { calls.push(ids); return values(ids); } };
    const pop = new PopScore({ store, igdb, batchSize: 3 });
    try {
        store.savePopularity(values([1]), '2026-11-10T00:00:00Z');
        pop.requestCold();
        assert.equal(pop.refresh(), 'running');
        await pop.running;
        assert.deepEqual(calls.map(c => c.length), [3, 3, 1]);
        assert.ok(!calls.flat().includes(1));
        assert.equal(pop.job.completed, 7);
        assert.equal(pop.job.state, 'completed');
        pop.requestCold();
        assert.equal(pop.running, null);
        store.upsertGames([{ id: 90, name: 'New game', releases: [] }]);
        pop.requestCold();
        await pop.running;
        assert.deepEqual(calls.at(-1), [90]);
        assert.deepEqual(store.popularityGameIds(true), []);
    } finally {
        await pop.stop();
        store.close();
    }
});

test('cancel aborts active batch but retains committed batches and prior scores', async () => {
    const { store } = seededStore();
    let calls = 0;
    const igdb = {
        configured: true,
        async popularityByIds(ids, signal) {
            if (++calls === 1) return values(ids);
            return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
        },
    };
    const pop = new PopScore({ store, igdb, batchSize: 2 });
    try {
        store.savePopularity([{ id: 3, visits: 1, wantToPlay: 1 }], '2026-11-10T00:00:00Z');
        pop.refresh();
        await turn();
        assert.equal(pop.job.completed, 2);
        assert.equal(pop.status().running, true);
        pop.cancel();
        await pop.running;
        assert.equal(pop.job.state, 'canceled');
        assert.equal(pop.status().lastCompleted, null);
        assert.equal(store.db.prepare('select visits from game_popularity where game_id = 3').get().visits, 1);
        assert.equal(store.db.prepare('select count(*) as n from game_popularity').get().n, 3);
    } finally {
        await pop.stop();
        store.close();
    }
});

test('startup fills a cold cache without blocking and cancellation does not restart queued cold work', async () => {
    const { store } = seededStore();
    const clock = () => new Date('2026-11-15T12:00:00Z');
    let calls = 0;
    const igdb = {
        configured: true,
        async popularityByIds(ids, signal) {
            calls++;
            return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
        },
    };
    const pop = new PopScore({ store, igdb, clock });
    try {
        pop.start();
        await turn();
        assert.equal(pop.job.trigger, 'scheduled');
        assert.equal(pop.status().running, true);
        pop.requestCold();
        pop.cancel();
        await pop.running;
        assert.equal(pop.job.state, 'canceled');
        assert.equal(calls, 1);
        assert.equal(pop.running, null);
        pop.tick();
        assert.equal(pop.running, null, 'the same scheduled occurrence is not retried in a tight loop');
    } finally {
        await pop.stop();
        store.close();
    }
});

test('scheduled refresh is independent of manual runs and queues behind an active job', async () => {
    const { store } = seededStore();
    let now = new Date('2026-11-15T05:59:00Z');
    let release;
    let calls = 0;
    const igdb = {
        configured: true,
        async popularityByIds(ids) {
            if (++calls === 1) await new Promise(resolve => { release = resolve; });
            return values(ids);
        },
    };
    const pop = new PopScore({ store, igdb, clock: () => now });
    try {
        const next = pop.status().nextRefresh;
        pop.refresh();
        await turn();
        store.setMeta('popscore_scheduled', '2026-11-14T06:00:00.000Z');
        now = new Date('2026-11-15T06:00:00Z');
        pop.tick();
        assert.equal(pop.pendingDaily, '2026-11-15T06:00:00.000Z');
        release();
        await pop.running;
        if (pop.running) await pop.running;
        assert.equal(calls, 2);
        assert.equal(pop.job.trigger, 'scheduled');
        assert.notEqual(pop.status().nextRefresh, next);
        assert.equal(pop.status().nextRefresh, '2026/11/16 07:00:00 Europe/Berlin');
        pop.refresh();
        await pop.running;
        assert.equal(pop.status().nextRefresh, '2026/11/16 07:00:00 Europe/Berlin');
    } finally {
        await pop.stop();
        store.close();
    }
});

test('failures preserve cache, record failure, and interrupted persisted jobs recover', async () => {
    const { store } = seededStore();
    const igdb = { configured: true, async popularityByIds() { throw new Error('IGDB down'); } };
    const pop = new PopScore({ store, igdb, log: quiet });
    try {
        store.savePopularity([{ id: 1, visits: .4, wantToPlay: .3 }], '2026-11-10T00:00:00Z');
        pop.refresh();
        await pop.running;
        assert.equal(pop.job.state, 'failed');
        assert.equal(store.db.prepare('select visits from game_popularity where game_id = 1').get().visits, .4);
        store.setMeta('popscore_job', JSON.stringify({ state: 'fetching_metrics', completed: 3, total: 8 }));
        const restored = new PopScore({ store, igdb, log: quiet });
        assert.equal(restored.job.state, 'interrupted');
        assert.equal(restored.job.completed, 3);
        restored.start();
        await restored.running;
        await restored.stop();
    } finally {
        await pop.stop();
        store.close();
    }
});
