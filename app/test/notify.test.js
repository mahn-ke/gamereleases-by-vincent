import test from 'node:test';
import assert from 'node:assert/strict';
import { Notifier, composeMail } from '../src/notify.js';
import { seededStore, testConfig } from './helpers.js';

const quiet = { info() {}, warn() {}, error() {} };

function fakeTransport({ failFor = [] } = {}) {
    const sent = [];
    return {
        sent,
        async sendMail(mail) {
            if (failFor.includes(mail.to)) throw new Error('SMTP refused');
            sent.push(mail);
        },
    };
}

// 2026-11-13 00:00:30 in Berlin (CET) is 2026-11-12 23:00:30 UTC
const midnightBeforeNov14 = () => new Date('2026-11-12T23:00:30Z');

test('mails each user once about tracked games releasing tomorrow (Berlin)', async () => {
    const { store, alice, bob } = seededStore();
    store.setReminder(alice.id, 1, true);
    store.setReminder(alice.id, 2, true);
    store.setReminder(alice.id, 3, true); // releases the day after tomorrow
    store.setReminder(bob.id, 2, true);
    const transport = fakeTransport();
    const notifier = new Notifier({ store, transport, config: testConfig(), log: quiet, clock: midnightBeforeNov14 });

    assert.deepEqual(await notifier.runIfDue(), { sent: 2, failed: 0 });
    assert.equal(transport.sent.length, 2);
    const toAlice = transport.sent.find(mail => mail.to === 'alice@example.test');
    assert.equal(toAlice.from, 'releases@example.test');
    assert.equal(toAlice.subject, "Out tomorrow: 2 games you're tracking");
    assert.match(toAlice.text, /Releasing tomorrow, Saturday, November 14, 2026:/);
    assert.match(toAlice.text, /Ova Magica \(PlayStation 5 \/ Xbox Series X\)/);
    assert.doesNotMatch(toAlice.text, /Remastered/);
    const toBob = transport.sent.find(mail => mail.to === 'bob@example.test');
    assert.equal(toBob.subject, 'Out tomorrow: Warhammer Survivors');

    // Same Berlin day: not due again; forced rerun finds nothing new
    assert.equal(await notifier.runIfDue(), null);
    assert.deepEqual(await notifier.run(), { sent: 0, failed: 0 });
    assert.equal(transport.sent.length, 2);
});

test('a failed mail is retried later without resending successful ones', async () => {
    const { store, alice, bob } = seededStore();
    store.setReminder(alice.id, 1, true);
    store.setReminder(bob.id, 2, true);
    const flaky = fakeTransport({ failFor: ['bob@example.test'] });
    const notifier = new Notifier({ store, transport: flaky, config: testConfig(), log: quiet, clock: midnightBeforeNov14 });
    assert.deepEqual(await notifier.runIfDue(), { sent: 1, failed: 1 });
    assert.equal(store.getMeta('last_notify_day'), null);

    const healthy = fakeTransport();
    notifier.transport = healthy;
    assert.deepEqual(await notifier.runIfDue(), { sent: 1, failed: 0 });
    assert.deepEqual(healthy.sent.map(mail => mail.to), ['bob@example.test']);
    assert.equal(store.getMeta('last_notify_day'), '2026-11-13');
});

test('refreshes tracked games before mailing and tolerates IGDB failures', async () => {
    const { store, alice } = seededStore();
    store.setReminder(alice.id, 1, true);
    let refreshed = 0;
    const sync = { async refreshTracked() { refreshed++; throw new Error('IGDB down'); } };
    const transport = fakeTransport();
    const notifier = new Notifier({ store, transport, sync, config: testConfig(), log: quiet, clock: midnightBeforeNov14 });
    await notifier.run();
    assert.equal(refreshed, 1);
    assert.equal(transport.sent.length, 1);
});

test('mail HTML escapes game names', () => {
    const mail = composeMail({
        recipient: { games: [{ id: 3, name: '<script>x</script>', url: 'https://x.test/?a=1&b="2"', platforms: ['Switch'] }] },
        day: '2026-11-15',
        baseUrl: 'https://gamereleases.example.test',
    });
    assert.doesNotMatch(mail.html, /<script>/);
    assert.match(mail.html, /&lt;script&gt;x&lt;\/script&gt;/);
    assert.match(mail.html, /href="https:\/\/x\.test\/\?a=1&amp;b=&quot;2&quot;"/);
});

test('users who switched release mails off are skipped', async () => {
    const { store, alice, bob } = seededStore();
    store.setReminder(alice.id, 1, true);
    store.setReminder(bob.id, 2, true);
    store.setEmailNotifications(alice.id, false);
    const transport = fakeTransport();
    const notifier = new Notifier({ store, transport, config: testConfig(), log: quiet, clock: midnightBeforeNov14 });
    assert.deepEqual(await notifier.run(), { sent: 1, failed: 0 });
    assert.deepEqual(transport.sent.map(mail => mail.to), ['bob@example.test']);
});
