import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const turn = () => new Promise(resolve => setImmediate(resolve));

function client(widget, fetch) {
    const listeners = new Map();
    const elements = new Map();
    const timers = new Map();
    let timerId = 0;
    const panel = {
        querySelector(selector) {
            if (!elements.has(selector)) elements.set(selector, {
                textContent: '', hidden: false, disabled: false,
                addEventListener(event, callback) { listeners.set(`${selector}:${event}`, callback); },
            });
            return elements.get(selector);
        },
    };
    const document = {
        hidden: false,
        querySelector() { return widget ? panel : null; },
        querySelectorAll() { return []; },
        addEventListener(event, callback) { listeners.set(`document:${event}`, callback); },
    };
    runInNewContext(script, {
        document, fetch, AbortController, console,
        window: { addEventListener(event, callback) { listeners.set(`window:${event}`, callback); } },
        setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
        clearTimeout(id) { timers.delete(id); },
    });
    return { document, elements, listeners, timers };
}

test('ordinary pages do not request admin status or schedule widget polling', () => {
    const page = client(false, () => { throw new Error('Should not fetch'); });
    assert.equal(page.timers.size, 0);
});

test('admin widget shows progress, cancellation, completion and next schedule without blocking page actions', async () => {
    const calls = [];
    let state = {
        configured: true, running: true,
        job: { state: 'fetching_metrics', completed: 20, total: 200 },
        lastCompleted: null, nextRefresh: '2026/12/22 07:00:00 Europe/Berlin',
    };
    const page = client(true, async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/cancel')) state = { ...state, running: false, job: { ...state.job, state: 'canceled' } };
        return { ok: true, status: 200, json: async () => state };
    });
    await turn();
    assert.match(page.elements.get('[data-popscore-state]').textContent, /20 of 200 games refreshed/);
    assert.equal(page.elements.get('progress').value, 20);
    assert.equal(page.elements.get('progress').max, 200);
    assert.equal(page.elements.get('[data-popscore-cancel]').hidden, false);
    await page.listeners.get('[data-popscore-cancel]:click')();
    assert.equal(calls.at(-1).options.method, 'POST');
    assert.match(page.elements.get('[data-popscore-state]').textContent, /Canceled/);
    state = {
        ...state, job: { state: 'completed', completed: 200, total: 200 },
        lastCompleted: '2026/12/21 15:12:23 Europe/Berlin',
    };
    page.document.hidden = true;
    page.listeners.get('document:visibilitychange')();
    assert.equal(page.timers.size, 0);
    page.document.hidden = false;
    page.listeners.get('document:visibilitychange')();
    await turn();
    assert.match(page.elements.get('[data-popscore-completed]').textContent, /Completed:|completed:/);
    assert.match(page.elements.get('[data-popscore-completed]').textContent, /2026\/12\/21 15:12:23 Europe\/Berlin/);
    assert.match(page.elements.get('[data-popscore-next]').textContent, /2026\/12\/22 07:00:00 Europe\/Berlin/);
    assert.equal(page.elements.get('[data-popscore-busy]').hidden, true);
    page.listeners.get('window:pagehide')();
    assert.equal(page.timers.size, 0);
});
