import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
create table if not exists users (
    id integer primary key,
    sub text not null unique,
    username text not null unique,
    email text,
    name text,
    ics_token text not null,
    created_at integer not null
);
create table if not exists sessions (
    id text primary key,
    user_id integer not null references users(id) on delete cascade,
    id_token text,
    expires_at integer not null
);
create table if not exists login_states (
    state text primary key,
    verifier text not null,
    return_to text,
    created_at integer not null
);
create table if not exists games (
    id integer primary key,
    name text not null,
    slug text,
    url text,
    cover_image_id text,
    art_image_id text,
    video_id text,
    hypes integer not null default 0,
    updated_at integer not null
);
create table if not exists releases (
    game_id integer not null references games(id) on delete cascade,
    -- exact release day, or the last day of the period for tentative dates
    day text not null,
    platform text not null,
    precision text not null default 'day' check (precision in ('day', 'month', 'quarter', 'year')),
    primary key (game_id, day, platform, precision)
);
create index if not exists releases_day on releases(day);
create table if not exists reminders (
    user_id integer not null references users(id) on delete cascade,
    game_id integer not null references games(id) on delete cascade,
    created_at integer not null,
    primary key (user_id, game_id)
);
create table if not exists notifications (
    user_id integer not null references users(id) on delete cascade,
    game_id integer not null,
    day text not null,
    sent_at integer not null,
    primary key (user_id, game_id, day)
);
create table if not exists meta (
    key text primary key,
    value text
);
`;

export function newToken() {
    return randomBytes(24).toString('base64url');
}

const now = () => Math.floor(Date.now() / 1000);

export function openDatabase(dataDir) {
    let file = ':memory:';
    if (dataDir !== ':memory:') {
        mkdirSync(dataDir, { recursive: true });
        file = path.join(dataDir, 'gamereleases.sqlite');
    }
    const db = new DatabaseSync(file);
    db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;');
    // Releases are a re-syncable cache: rebuild tables that predate tentative dates
    const releaseColumns = db.prepare('pragma table_info(releases)').all().map(column => column.name);
    if (releaseColumns.length && !releaseColumns.includes('precision')) db.exec('drop table releases');
    db.exec(SCHEMA);
    return new Store(db);
}

function transaction(db, fn) {
    db.exec('begin');
    try {
        const result = fn();
        db.exec('commit');
        return result;
    } catch (error) {
        db.exec('rollback');
        throw error;
    }
}

// Order of releases sharing a day: exact first, then month, quarter and year estimates
const PRECISION_RANK = "case r.precision when 'day' then 0 when 'month' then 1 when 'quarter' then 2 else 3 end";

function withPlatforms(rows) {
    return rows.map(row => ({ ...row, platforms: row.platforms ? row.platforms.split('\u001f') : [] }));
}

export class Store {
    constructor(db) {
        this.db = db;
    }

    close() {
        this.db.close();
    }

    getMeta(key) {
        return this.db.prepare('select value from meta where key = ?').get(key)?.value ?? null;
    }

    setMeta(key, value) {
        this.db.prepare('insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value').run(key, String(value));
    }

    // Users -----------------------------------------------------------------

    upsertUser({ sub, username, email, name }) {
        const existing = this.db.prepare('select * from users where sub = ?').get(sub);
        if (existing) {
            this.db.prepare('update users set email = ?, name = ? where id = ?').run(email ?? null, name ?? null, existing.id);
            return { ...existing, email: email ?? null, name: name ?? null };
        }
        // Usernames appear in calendar URLs, so they stay stable once assigned
        let candidate = username;
        for (let i = 2; this.db.prepare('select 1 from users where username = ?').get(candidate); i++) {
            candidate = `${username}-${i}`;
        }
        const result = this.db.prepare('insert into users (sub, username, email, name, ics_token, created_at) values (?, ?, ?, ?, ?, ?)')
            .run(sub, candidate, email ?? null, name ?? null, newToken(), now());
        return this.db.prepare('select * from users where id = ?').get(result.lastInsertRowid);
    }

    getUserByUsername(username) {
        return this.db.prepare('select * from users where username = ?').get(username) ?? null;
    }

    regenerateIcsToken(userId) {
        const token = newToken();
        this.db.prepare('update users set ics_token = ? where id = ?').run(token, userId);
        return token;
    }

    // Sessions --------------------------------------------------------------

    createSession(userId, idToken, ttlSeconds) {
        const id = newToken();
        this.db.prepare('insert into sessions (id, user_id, id_token, expires_at) values (?, ?, ?, ?)').run(id, userId, idToken ?? null, now() + ttlSeconds);
        return id;
    }

    getSessionUser(sessionId) {
        if (!sessionId) return null;
        return this.db.prepare(`select users.* from sessions join users on users.id = sessions.user_id
            where sessions.id = ? and sessions.expires_at > ?`).get(sessionId, now()) ?? null;
    }

    deleteSession(sessionId) {
        this.db.prepare('delete from sessions where id = ?').run(sessionId);
    }

    saveLoginState(state, verifier, returnTo) {
        this.db.prepare('delete from login_states where created_at < ?').run(now() - 600);
        this.db.prepare('insert into login_states (state, verifier, return_to, created_at) values (?, ?, ?, ?)').run(state, verifier, returnTo ?? null, now());
    }

    takeLoginState(state) {
        const row = this.db.prepare('select * from login_states where state = ? and created_at >= ?').get(state, now() - 600);
        this.db.prepare('delete from login_states where state = ?').run(state);
        return row ?? null;
    }

    pruneSessions() {
        this.db.prepare('delete from sessions where expires_at <= ?').run(now());
    }

    // Games -----------------------------------------------------------------

    upsertGames(games) {
        const upsert = this.db.prepare(`insert into games (id, name, slug, url, cover_image_id, art_image_id, video_id, hypes, updated_at)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(id) do update set name = excluded.name, slug = excluded.slug, url = excluded.url,
                cover_image_id = excluded.cover_image_id, art_image_id = excluded.art_image_id,
                video_id = excluded.video_id, hypes = excluded.hypes, updated_at = excluded.updated_at`);
        const clear = this.db.prepare('delete from releases where game_id = ?');
        const insert = this.db.prepare('insert or ignore into releases (game_id, day, platform, precision) values (?, ?, ?, ?)');
        transaction(this.db, () => {
            for (const game of games) {
                upsert.run(game.id, game.name, game.slug ?? null, game.url ?? null, game.coverImageId ?? null,
                    game.artImageId ?? null, game.videoId ?? null, game.hypes ?? 0, now());
                clear.run(game.id);
                for (const release of game.releases) insert.run(game.id, release.day, release.platform, release.precision ?? 'day');
            }
        });
    }

    trackedGameIds() {
        return this.db.prepare('select distinct game_id from reminders').all().map(row => row.game_id);
    }

    // Release cards for a day range, one per game and day, with the viewer's reminder state
    releasesBetween(fromDay, toDay, { userId = null, platforms = [] } = {}) {
        const platformFilter = platforms.length ? `and r.game_id in (select game_id from releases p where p.day = r.day and p.precision = r.precision and p.platform in (${platforms.map(() => '?').join(',')}))` : '';
        const rows = this.db.prepare(`select r.day, r.precision, g.*, group_concat(r.platform, char(31)) as platforms,
                (select count(*) from reminders m where m.game_id = g.id) as reminder_count,
                exists(select 1 from reminders m where m.game_id = g.id and m.user_id = ?) as reminded
            from releases r join games g on g.id = r.game_id
            where r.day >= ? and r.day <= ? ${platformFilter}
            group by r.day, r.precision, g.id
            order by r.day asc, ${PRECISION_RANK}, reminder_count desc, g.hypes desc, g.name asc`)
            .all(userId, fromDay, toDay, ...platforms);
        return withPlatforms(rows);
    }

    // Most anticipated upcoming games (each listed once, on its next release day)
    hotReleases(fromDay, toDay, { userId = null, platforms = [], limit = 60 } = {}) {
        const platformFilter = platforms.length ? `and r.platform in (${platforms.map(() => '?').join(',')})` : '';
        const rows = this.db.prepare(`with next as (
                select r.game_id, min(r.day) as day from releases r where r.day >= ? and r.day <= ? ${platformFilter} group by r.game_id
            )
            select next.day, g.*,
                (select r.precision from releases r where r.game_id = g.id and r.day = next.day order by ${PRECISION_RANK} limit 1) as precision,
                (select group_concat(platform, char(31)) from releases r where r.game_id = g.id and r.day = next.day
                    and r.precision = (select r.precision from releases r where r.game_id = g.id and r.day = next.day order by ${PRECISION_RANK} limit 1)) as platforms,
                (select count(*) from reminders m where m.game_id = g.id) as reminder_count,
                exists(select 1 from reminders m where m.game_id = g.id and m.user_id = ?) as reminded
            from next join games g on g.id = next.game_id
            order by g.hypes desc, reminder_count desc, next.day asc limit ?`)
            .all(fromDay, toDay, ...platforms, userId, limit);
        return withPlatforms(rows);
    }

    // The viewer's reminders, each on its next release day (or without one when unannounced)
    userReminders(userId, today) {
        const rows = this.db.prepare(`select g.*,
                (select min(day) from releases r where r.game_id = g.id and r.day >= ?) as day,
                (select max(day) from releases r where r.game_id = g.id and r.day < ? and r.precision = 'day') as past_day,
                (select count(*) from reminders m where m.game_id = g.id) as reminder_count,
                1 as reminded
            from reminders m join games g on g.id = m.game_id
            where m.user_id = ?
            order by day is null, day asc, past_day desc, g.name asc`).all(today, today, userId);
        return rows.map(row => this.withNextRelease(row, row.day ?? row.past_day));
    }

    // Adds the precision and platforms of a game's release on `day` (exact before estimates)
    withNextRelease(row, day) {
        if (!day) return { ...row, precision: null, platforms: [] };
        const releases = this.db.prepare(`select r.platform, r.precision from releases r where r.game_id = ? and r.day = ?
            order by ${PRECISION_RANK}, r.platform`).all(row.id, day);
        const precision = releases[0]?.precision ?? null;
        return { ...row, day, precision, platforms: releases.filter(r => r.precision === precision).map(r => r.platform) };
    }

    // Search results, each shown with its next release (or its latest one when all are past)
    gamesByIds(ids, userId = null, today = '0000-00-00') {
        if (!ids.length) return [];
        const rows = this.db.prepare(`select g.*,
                coalesce((select min(day) from releases r where r.game_id = g.id and r.day >= ?),
                         (select max(day) from releases r where r.game_id = g.id)) as next_day,
                (select count(*) from reminders m where m.game_id = g.id) as reminder_count,
                exists(select 1 from reminders m where m.game_id = g.id and m.user_id = ?) as reminded
            from games g where g.id in (${ids.map(() => '?').join(',')})`).all(today, userId, ...ids);
        const byId = new Map(rows.map(row => [row.id, row]));
        return ids.map(id => byId.get(id)).filter(Boolean).map(row => this.withNextRelease(row, row.next_day));
    }

    platformsInUse(fromDay) {
        return this.db.prepare('select platform, count(distinct game_id) as games from releases where day >= ? group by platform order by games desc')
            .all(fromDay).map(row => row.platform);
    }

    searchLocal(text, limit = 40) {
        const pattern = `%${text.replace(/[\\%_]/g, char => `\\${char}`)}%`;
        return this.db.prepare("select id from games where name like ? escape '\\' order by hypes desc, name limit ?")
            .all(pattern, limit).map(row => row.id);
    }

    gameExists(gameId) {
        return !!this.db.prepare('select 1 from games where id = ?').get(gameId);
    }

    // Reminders -------------------------------------------------------------

    setReminder(userId, gameId, enabled) {
        if (enabled) {
            this.db.prepare('insert or ignore into reminders (user_id, game_id, created_at) values (?, ?, ?)').run(userId, gameId, now());
        } else {
            this.db.prepare('delete from reminders where user_id = ? and game_id = ?').run(userId, gameId);
        }
        return this.db.prepare('select count(*) as count from reminders where game_id = ?').get(gameId).count;
    }

    // Calendar entries for a user's ICS feed
    userReleaseDays(userId) {
        return withPlatforms(this.db.prepare(`select r.day, g.id, g.name, g.url, group_concat(r.platform, char(31)) as platforms
            from reminders m join releases r on r.game_id = m.game_id and r.precision = 'day' join games g on g.id = m.game_id
            where m.user_id = ? group by r.day, g.id order by r.day`).all(userId));
    }

    // Reminders releasing on `day` that have not been emailed yet, grouped by user
    pendingNotifications(day) {
        const rows = withPlatforms(this.db.prepare(`select u.id as user_id, u.email, u.name as user_name, u.username,
                g.id as game_id, g.name, g.url, group_concat(r.platform, char(31)) as platforms
            from reminders m join users u on u.id = m.user_id join releases r on r.game_id = m.game_id and r.day = ? and r.precision = 'day'
            join games g on g.id = m.game_id
            where u.email is not null and u.email != ''
              and not exists (select 1 from notifications n where n.user_id = u.id and n.game_id = g.id and n.day = ?)
            group by u.id, g.id order by u.id, g.name`).all(day, day));
        const byUser = new Map();
        for (const row of rows) {
            if (!byUser.has(row.user_id)) byUser.set(row.user_id, { userId: row.user_id, email: row.email, name: row.user_name, username: row.username, games: [] });
            byUser.get(row.user_id).games.push({ id: row.game_id, name: row.name, url: row.url, platforms: row.platforms });
        }
        return [...byUser.values()];
    }

    markNotified(userId, gameIds, day) {
        const insert = this.db.prepare('insert or ignore into notifications (user_id, game_id, day, sent_at) values (?, ?, ?, ?)');
        transaction(this.db, () => {
            for (const gameId of gameIds) insert.run(userId, gameId, day, now());
        });
    }
}
