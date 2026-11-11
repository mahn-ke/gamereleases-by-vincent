import { addDays, dayInZone, dayToUnix } from './time.js';

export class Sync {
    constructor({ store, igdb, config, log = console }) {
        this.store = store;
        this.igdb = igdb;
        this.config = config;
        this.log = log;
        this.running = null;
    }

    // Tracked games are refreshed individually so reminders outside the window stay current
    async refreshTracked() {
        const ids = this.store.trackedGameIds();
        if (!ids.length || !this.igdb.configured) return 0;
        const games = await this.igdb.gamesByIds(ids);
        this.store.upsertGames(games);
        return games.length;
    }

    async run(now = new Date()) {
        if (this.running) return this.running;
        this.running = (async () => {
            if (!this.igdb.configured) {
                this.log.warn('IGDB sync skipped: TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET are not set');
                return;
            }
            const today = dayInZone(now, this.config.timeZone);
            const from = dayToUnix(addDays(today, -this.config.syncDaysBack));
            const to = dayToUnix(addDays(today, this.config.syncDaysAhead + 1));
            const games = await this.igdb.gamesReleasingBetween(from, to);
            this.store.upsertGames(games);
            const tracked = await this.refreshTracked();
            this.store.setMeta('last_sync', new Date().toISOString());
            this.store.pruneSessions();
            this.log.info(`IGDB sync: ${games.length} games in window, ${tracked} tracked refreshed`);
        })().finally(() => { this.running = null; });
        return this.running;
    }

    start() {
        const tick = () => this.run().catch(error => this.log.error('IGDB sync failed:', error.message));
        tick();
        this.timer = setInterval(tick, this.config.syncIntervalMs);
        this.timer.unref?.();
    }

    stop() {
        clearInterval(this.timer);
    }
}
