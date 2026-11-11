import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dayInZone, dayLabel, isDay, nextMidnightInZone, shortDayLabel, startOfDayInZone } from '../src/time.js';

const TZ = 'Europe/Berlin';

test('Berlin day boundaries in winter and summer time', () => {
    assert.equal(dayInZone(new Date('2026-11-10T22:59:59Z'), TZ), '2026-11-10');
    assert.equal(dayInZone(new Date('2026-11-10T23:00:00Z'), TZ), '2026-11-11');
    assert.equal(dayInZone(new Date('2026-07-10T21:59:59Z'), TZ), '2026-07-10');
    assert.equal(dayInZone(new Date('2026-07-10T22:00:00Z'), TZ), '2026-07-11');
});

test('next Berlin midnight is exact, including around DST switches', () => {
    assert.equal(nextMidnightInZone(new Date('2026-11-10T12:00:00Z'), TZ).toISOString(), '2026-11-10T23:00:00.000Z');
    assert.equal(nextMidnightInZone(new Date('2026-07-10T12:00:00Z'), TZ).toISOString(), '2026-07-10T22:00:00.000Z');
    // DST starts 2026-03-29 02:00, ends 2026-10-25 03:00
    assert.equal(nextMidnightInZone(new Date('2026-03-29T12:00:00Z'), TZ).toISOString(), '2026-03-29T22:00:00.000Z');
    assert.equal(nextMidnightInZone(new Date('2026-03-28T12:00:00Z'), TZ).toISOString(), '2026-03-28T23:00:00.000Z');
    assert.equal(nextMidnightInZone(new Date('2026-10-25T12:00:00Z'), TZ).toISOString(), '2026-10-25T23:00:00.000Z');
    assert.equal(nextMidnightInZone(new Date('2026-10-24T12:00:00Z'), TZ).toISOString(), '2026-10-24T22:00:00.000Z');
    assert.equal(startOfDayInZone('2026-01-01', TZ).toISOString(), '2025-12-31T23:00:00.000Z');
});

test('day helpers', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.ok(isDay('2026-11-10'));
    assert.ok(!isDay('2026-02-30'));
    assert.ok(!isDay('2026-11-10T00:00'));
    assert.ok(!isDay(undefined));
    assert.equal(dayLabel('2026-11-10', '2026-11-10'), 'Today');
    assert.equal(dayLabel('2026-11-11', '2026-11-10'), 'Tomorrow');
    assert.equal(dayLabel('2026-11-14', '2026-11-10'), 'Saturday, Nov 14');
    assert.equal(shortDayLabel('2026-11-10'), 'Nov 10th');
    assert.equal(shortDayLabel('2026-11-01'), 'Nov 1st');
    assert.equal(shortDayLabel('2026-11-12'), 'Nov 12th');
    assert.equal(shortDayLabel('2026-11-22'), 'Nov 22nd');
});
