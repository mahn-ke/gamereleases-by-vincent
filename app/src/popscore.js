import { randomUUID } from 'node:crypto';
import { dailyRefreshTimes, timestampInZone } from './time.js';

const ACTIVE = new Set(['fetching_list', 'fetching_metrics', 'saving_batch', 'canceling']);

export class PopScore {
    constructor({ store, igdb, timeZone = 'Europe/Berlin', clock = () => new Date(), log = console, batchSize = 200 }) {
        Object.assign(this, { store, igdb, timeZone, clock, log, batchSize });
        this.job = JSON.parse(store.getMeta('popscore_job') || 'null');
        this.pendingCold = false;
        this.pendingDaily = null;
        this.stopped = false;
        if (this.job && ACTIVE.has(this.job.state)) this.update({ state: 'interrupted', endedAt: this.clock().toISOString() });
    }

    update(fields) {
        this.job = { ...this.job, ...fields };
        this.store.setMeta('popscore_job', JSON.stringify(this.job));
    }

    status() {
        const next = dailyRefreshTimes(this.clock(), this.timeZone).next.toISOString();
        const completed = this.store.getMeta('popscore_completed');
        return {
            configured: this.igdb.configured, running: Boolean(this.running), job: this.job,
            lastCompleted: timestampInZone(completed, this.timeZone),
            nextRefresh: timestampInZone(next, this.timeZone),
        };
    }

    start() {
        this.tick();
        this.requestCold();
        this.schedule();
    }

    schedule() {
        const delay = dailyRefreshTimes(this.clock(), this.timeZone).next.getTime() - this.clock().getTime();
        this.timer = setTimeout(() => {
            this.tick();
            this.schedule();
        }, Math.max(1, delay));
        this.timer.unref?.();
    }

    tick() {
        if (this.stopped || !this.igdb.configured) return;
        const occurrence = dailyRefreshTimes(this.clock(), this.timeZone).latest.toISOString();
        if (this.store.getMeta('popscore_scheduled') !== occurrence) {
            this.pendingDaily = occurrence;
            this.drain();
        }
    }

    requestCold() {
        if (this.stopped || !this.igdb.configured) return;
        this.pendingCold = true;
        this.drain();
    }

    drain() {
        if (this.stopped || this.running) return;
        if (this.pendingDaily) {
            this.store.setMeta('popscore_scheduled', this.pendingDaily);
            this.pendingDaily = null;
            this.launch('scheduled');
        } else if (this.pendingCold) {
            this.pendingCold = false;
            if (this.store.popularityGameIds(true).length) this.launch('cold');
        }
    }

    refresh() {
        if (this.stopped || !this.igdb.configured) return 'unavailable';
        if (this.running) return 'running';
        this.launch('manual');
        return 'started';
    }

    launch(trigger) {
        this.controller = new AbortController();
        this.update({
            id: randomUUID(), trigger, state: 'fetching_list', completed: 0, total: 0,
            startedAt: this.clock().toISOString(), endedAt: null, error: null,
        });
        // Defer work until after the start endpoint has returned.
        this.running = Promise.resolve().then(() => this.run(trigger, this.controller.signal)).finally(() => {
            this.running = null;
            this.controller = null;
            this.drain();
        });
    }

    async run(trigger, signal) {
        try {
            signal.throwIfAborted();
            const ids = this.store.popularityGameIds(trigger === 'cold');
            this.update({ total: ids.length });
            for (let i = 0; i < ids.length; i += this.batchSize) {
                this.update({ state: 'fetching_metrics' });
                const scores = await this.igdb.popularityByIds(ids.slice(i, i + this.batchSize), signal);
                signal.throwIfAborted();
                this.update({ state: 'saving_batch' });
                this.store.savePopularity(scores, this.clock().toISOString());
                this.update({ completed: this.job.completed + scores.length });
            }
            const endedAt = this.clock().toISOString();
            this.store.setMeta('popscore_completed', endedAt);
            this.update({ state: 'completed', endedAt });
        } catch (error) {
            const canceled = signal.aborted;
            if (!canceled) this.log.error('PopScore refresh failed:', error);
            this.update({
                state: canceled ? 'canceled' : 'failed', endedAt: this.clock().toISOString(),
                error: canceled ? null : 'Refreshing IGDB popularity failed; completed batches were retained. Try again.',
            });
        }
    }

    cancel() {
        if (!this.running) return;
        this.pendingCold = false;
        this.update({ state: 'canceling' });
        this.controller.abort();
    }

    async stop() {
        this.stopped = true;
        clearTimeout(this.timer);
        this.cancel();
        await this.running;
    }
}
