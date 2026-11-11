import { html, raw, toString } from './html.js';
import { coverUrl } from './igdb.js';
import { addDays, dayLabel, estimateLabel, shortDayLabel } from './time.js';

const icon = {
    bell: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1Z"/></svg>'),
    play: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'),
    pad: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6h10a5 5 0 0 1 4.9 6l-1 4.6a2.6 2.6 0 0 1-4.5 1.2L14.3 15H9.7l-2.1 2.8a2.6 2.6 0 0 1-4.5-1.2l-1-4.6A5 5 0 0 1 7 6Zm1 3v2H6v2h2v2h2v-2h2v-2h-2V9Zm8.5 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm-2 3a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z"/></svg>'),
    flame: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 1s.7 2.6.7 4.7c0 2-1.3 3.6-3.3 3.6S7.6 7.7 7.6 5.7l.03-.4A11.6 11.6 0 0 0 5 13a7 7 0 0 0 14 0c0-5.1-2.4-9.6-5.5-12Zm-1.8 18c-1.8 0-3.2-1.4-3.2-3.1 0-1.6 1-2.7 2.8-3.1 1.8-.4 3.6-1.2 4.6-2.6.4 1.3.6 2.6.6 4A5 5 0 0 1 11.7 19Z"/></svg>'),
    calendar: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2Zm-2 8h14v10H5Zm2 2v2h2v-2Zm4 0v2h2v-2Zm4 0v2h2v-2Z"/></svg>'),
    home: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 12h3v8h5v-6h4v6h5v-8h3Z"/></svg>'),
    search: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.41 1.4-5.4-5.39A8 8 0 1 1 10 2Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z"/></svg>'),
    check: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 14.2L6.6 12l1.4-1.4 2.8 2.8 5.2-5.2 1.4 1.4Z"/></svg>'),
    filter: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18l-7 9v6l-4 2v-8Z"/></svg>'),
    user: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-5 0-9 2.5-9 5.5V22h18v-2.5c0-3-4-5.5-9-5.5Z"/></svg>'),
};

const ANTICIPATED_HYPES = 5;
// Year estimates can hold over a thousand games; show the most anticipated first
const TENTATIVE_PREVIEW = 24;
const PRECISION_ORDER = ['month', 'quarter', 'year'];

function query(params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        for (const item of [].concat(value ?? [])) if (item !== '' && item != null) search.append(key, item);
    }
    const text = search.toString();
    return text ? `?${text}` : '';
}

function bell(game, ctx) {
    const label = `${game.reminded ? 'Remove reminder for' : 'Remind me about'} ${game.name}`;
    if (!ctx.user) {
        return html`<a class="bell" href="/login${query({ return: ctx.path })}" title="Log in to set reminders" aria-label="${label}">${icon.bell}<span>${game.reminder_count}</span></a>`;
    }
    return html`<button type="button" class="bell${game.reminded ? ' on' : ''}" data-game="${game.id}" aria-pressed="${game.reminded ? 'true' : 'false'}" title="${label}" aria-label="${label}">${icon.bell}<span>${game.reminder_count}</span></button>`;
}

function card(game, ctx, { wide = false, showDay = false } = {}) {
    const cover = coverUrl(game.cover_image_id);
    const art = wide ? coverUrl(game.art_image_id, 't_screenshot_big') : null;
    const anticipated = game.hypes >= ANTICIPATED_HYPES;
    const tentative = game.day && game.precision && game.precision !== 'day';
    const dayText = tentative ? estimateLabel(game.precision, game.day, { withYear: true })
        : game.day ? (showDay ? dayLabel(game.day, ctx.today) : null) : (showDay ? 'No date yet' : null);
    return html`<article class="card${wide ? ' wide' : ''}">
        ${art ? html`<img class="art" src="${art}" alt="" loading="lazy">` : ''}
        <a class="cover" href="${game.url || '#'}" target="_blank" rel="noopener">
            ${cover ? html`<img src="${cover}" alt="${game.name} cover" loading="lazy">` : html`<span class="noimg">${icon.pad}<span>No image</span></span>`}
            ${anticipated ? html`<span class="badge">${icon.flame}Anticipated</span>` : ''}
            ${tentative ? html`<span class="badge est" title="Tentative release date">${estimateLabel(game.precision, game.day)}</span>` : ''}
        </a>
        <div class="meta">
            <h3 title="${game.name}">${game.name}</h3>
            <p class="platforms">${icon.pad}<span>${game.platforms.join(' / ') || 'Platforms TBA'}</span></p>
            ${dayText ? html`<p class="when${tentative ? ' est' : ''}"${tentative ? raw(' title="Tentative release date"') : ''}>${icon.calendar}<span>${dayText}</span></p>` : ''}
            <div class="actions">
                ${game.video_id ? html`<a class="play" href="https://www.youtube.com/watch?v=${game.video_id}" target="_blank" rel="noopener" title="Watch trailer" aria-label="Watch the ${game.name} trailer">${icon.play}</a>` : html`<span class="play disabled" aria-hidden="true">${icon.play}</span>`}
                ${bell(game, ctx)}
            </div>
        </div>
    </article>`;
}

function grid(games, ctx, options = {}) {
    // The two most anticipated releases of a day get the wide treatment, like the featured row
    const featured = options.feature ? new Set(games.filter(g => g.hypes >= ANTICIPATED_HYPES && g.art_image_id && (g.precision ?? 'day') === 'day').slice(0, 2).map(g => g.id)) : new Set();
    return html`<div class="grid">${games.map(game => card(game, ctx, { wide: featured.has(game.id), showDay: options.showDay }))}</div>`;
}

function sidebar(ctx) {
    const nav = (href, label, iconSvg, active) => html`<a class="nav${active ? ' active' : ''}" href="${href}">${iconSvg}<span>${label}</span></a>`;
    const selected = new Set(ctx.platforms);
    return html`<aside class="sidebar">
        <a class="logo" href="/" aria-label="gamereleases home"><span class="mark"><i></i><i></i><i></i></span><span>gamereleases</span></a>
        <nav>
            ${nav('/', 'Calendar', icon.home, ctx.view === 'calendar')}
            ${nav('/hot', 'Hot', icon.flame, ctx.view === 'hot')}
            ${nav('/search', 'Search', icon.search, ctx.view === 'search')}
            ${nav('/reminders', 'My reminders', icon.bell, ctx.view === 'reminders')}
        </nav>
        <div class="group">
            <div class="group-title">${icon.pad}<span>Games</span></div>
            <a class="sub${selected.size === 0 ? ' active' : ''}" href="${ctx.basePath}${query({ from: ctx.from })}">All</a>
            ${ctx.allPlatforms.map(platform => html`<a class="sub${selected.size === 1 && selected.has(platform) ? ' active' : ''}" href="${ctx.basePath}${query({ from: ctx.from, platform })}">${platform}</a>`)}
        </div>
        <div class="account">
            <div class="group-title small">Account</div>
            ${ctx.user ? html`
                <a class="nav" href="/reminders">${icon.user}<span>${ctx.user.name || ctx.user.username}</span></a>
                <form method="post" action="/logout"><button class="nav linkish" type="submit">${icon.user}<span>Log out</span></button></form>`
            : html`<a class="nav" href="/login${query({ return: ctx.path })}">${icon.user}<span>Log in</span></a>`}
        </div>
    </aside>`;
}

function filters(ctx) {
    if (!ctx.showFilters) return '';
    const selected = new Set(ctx.platforms);
    return html`<aside class="filters">
        <form method="get" action="${ctx.basePath}" class="filter-form">
            <h2>${icon.filter}<span>Filter</span></h2>
            ${ctx.from ? html`<input type="hidden" name="from" value="${ctx.from}">` : ''}
            <fieldset>
                <legend>Versions</legend>
                ${ctx.allPlatforms.map(platform => html`<label><input type="checkbox" name="platform" value="${platform}"${selected.has(platform) ? raw(' checked') : ''}><span>${platform}</span></label>`)}
            </fieldset>
            <noscript><button type="submit">Apply</button></noscript>
        </form>
    </aside>`;
}

function topbar(ctx) {
    const tab = (href, label, iconSvg, active) => html`<a class="tab${active ? ' active' : ''}" href="${href}${query({ platform: ctx.platforms })}">${iconSvg}<span>${label}</span></a>`;
    return html`<header class="topbar">
        ${ctx.view === 'calendar' ? html`<form class="datepick" method="get" action="/">
            ${ctx.platforms.map(p => html`<input type="hidden" name="platform" value="${p}">`)}
            <label>${icon.check}<strong>${shortDayLabel(ctx.from)}</strong><span>${ctx.from === ctx.today ? 'Today' : dayLabel(ctx.from, ctx.today)}</span>
            <input type="date" name="from" value="${ctx.from}" aria-label="Jump to date"></label>
            ${ctx.from !== ctx.today ? html`<a class="today" href="/${query({ platform: ctx.platforms })}">Today</a>` : ''}
        </form>` : html`<div class="title">${ctx.title}</div>`}
        <div class="tabs">
            ${tab('/', 'Calendar', icon.calendar, ctx.view === 'calendar')}
            ${tab('/hot', 'Hot', icon.flame, ctx.view === 'hot')}
        </div>
        <div class="title right">Games</div>
    </header>`;
}

export function layout(ctx, content) {
    return '<!doctype html>' + toString(html`<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${ctx.title ? `${ctx.title} · ` : ''}gamereleases</title>
<link rel="stylesheet" href="/static/app.css">
<link rel="icon" href="/static/icon.svg" type="image/svg+xml">
<script src="/static/app.js" defer></script>
</head>
<body>
<div class="shell${ctx.showFilters ? '' : ' no-filters'}">
    ${sidebar(ctx)}
    <main>
        ${topbar(ctx)}
        ${ctx.flash ? html`<p class="flash">${ctx.flash}</p>` : ''}
        ${content}
    </main>
    ${filters(ctx)}
</div>
</body>
</html>`);
}

function tentativeGroup(day, precision, games, ctx, { days, showAll }) {
    const shown = showAll ? games : games.slice(0, TENTATIVE_PREVIEW);
    return html`<div class="tentative">
        <h3><span>Tentative dates</span><span class="chip">${estimateLabel(precision, day)}</span><small class="count">${games.length} ${games.length === 1 ? 'game' : 'games'}</small></h3>
        ${grid(shown, ctx)}
        ${shown.length < games.length ? html`<a class="more" href="/${query({ from: day, days: 1, all: 1, platform: ctx.platforms })}">Show all ${games.length} · ${estimateLabel(precision, day, { withYear: true })}</a>` : ''}
    </div>`;
}

export function calendarPage(ctx, releases, { days, showAll = false }) {
    const byDay = new Map();
    for (const game of releases) {
        if (!byDay.has(game.day)) byDay.set(game.day, { exact: [], tentative: new Map() });
        const entry = byDay.get(game.day);
        if ((game.precision ?? 'day') === 'day') entry.exact.push(game);
        else {
            if (!entry.tentative.has(game.precision)) entry.tentative.set(game.precision, []);
            entry.tentative.get(game.precision).push(game);
        }
    }
    const later = addDays(ctx.from, days);
    const earlier = addDays(ctx.from, -days);
    const content = html`
        ${byDay.size === 0 ? html`<p class="empty">No releases with a known date between ${shortDayLabel(ctx.from)} and ${shortDayLabel(addDays(later, -1))}${ctx.syncNote ? html`. ${ctx.syncNote}` : ''}.</p>` : ''}
        ${[...byDay].map(([day, { exact, tentative }]) => html`<section class="day">
            <h2><span>${dayLabel(day, ctx.today)}</span>${day !== ctx.today && day !== addDays(ctx.today, 1) ? '' : html`<small>${shortDayLabel(day)}</small>`}${exact.length ? html`<small class="count">${exact.length} ${exact.length === 1 ? 'game' : 'games'}</small>` : ''}</h2>
            ${exact.length ? grid(exact, ctx, { feature: true }) : ''}
            ${PRECISION_ORDER.filter(p => tentative.has(p)).map(p => tentativeGroup(day, p, tentative.get(p), ctx, { days, showAll }))}
        </section>`)}
        <nav class="pager">
            <a href="/${query({ from: earlier, days: days === 14 ? null : days, platform: ctx.platforms })}">← ${shortDayLabel(earlier)}</a>
            <a href="/${query({ from: later, days: days === 14 ? null : days, platform: ctx.platforms })}">${shortDayLabel(later)} →</a>
        </nav>`;
    return layout(ctx, content);
}

export function hotPage(ctx, releases) {
    const content = releases.length
        ? html`<section class="day"><h2><span>Most anticipated</span><small class="count">next ${releases.length}</small></h2>${grid(releases, ctx, { showDay: true })}</section>`
        : html`<p class="empty">Nothing upcoming yet${ctx.syncNote ? html`. ${ctx.syncNote}` : ''}.</p>`;
    return layout(ctx, content);
}

export function searchPage(ctx, results, { q, error }) {
    const content = html`
        <form class="search" method="get" action="/search">
            <input type="search" name="q" value="${q}" placeholder="Search games…" autofocus aria-label="Search games">
            <button type="submit">${icon.search}<span>Search</span></button>
        </form>
        ${error ? html`<p class="flash">${error}</p>` : ''}
        ${q && !results.length ? html`<p class="empty">No games found for “${q}”.</p>` : ''}
        ${results.length ? grid(results, ctx, { showDay: true }) : ''}`;
    return layout(ctx, content);
}

const syncedFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function mailPanel(ctx, accountUrl) {
    const user = ctx.user;
    const enabled = user.email_notifications !== 0;
    const synced = user.email_synced_at ? syncedFormat.format(new Date(user.email_synced_at * 1000)) : null;
    return html`<section class="panel">
        <h2>Release mails</h2>
        <form method="post" action="/reminders/notifications" class="mail-form">
            <label class="toggle"><input type="checkbox" name="enabled" value="1"${enabled ? raw(' checked') : ''}>
                <span>Email me at 00:00 (Europe/Berlin) the day before a tracked game releases</span></label>
            <noscript><button type="submit" class="secondary">Save</button></noscript>
        </form>
        <p class="muted">${enabled ? 'Sending to' : 'Mails are off. Address on file:'} <strong>${user.email || 'no address on your SSO account'}</strong>${synced ? html` <span class="synced">(from SSO, ${synced})</span>` : ''}</p>
        ${accountUrl ? html`<p class="sso-links">
            <a class="button secondary" href="${accountUrl}">Change email in SSO</a>
            <a class="button secondary" href="/auth/refresh?return=%2Freminders">Refresh from SSO</a>
        </p>
        <p class="muted small">The address comes from your SSO account. After changing it there, use the account page's back link or "Refresh from SSO" so this app picks it up. If SSO asks you to verify the new address first, refresh again after confirming it.</p>` : ''}
    </section>`;
}

export function remindersPage(ctx, reminders, { icsUrl, accountUrl = null }) {
    const upcoming = reminders.filter(g => g.day);
    const undated = reminders.filter(g => !g.day && !g.past_day);
    const released = reminders.filter(g => !g.day && g.past_day).map(g => ({ ...g, day: g.past_day, precision: 'day' }));
    const content = html`
        <section class="panel">
            <h2>Calendar subscription</h2>
            <p>Subscribe to this address in your calendar app. It updates on its own and needs no login, so treat it like a password.</p>
            <div class="ics">
                <input type="text" readonly value="${icsUrl}" aria-label="Calendar subscription URL" id="ics-url">
                <button type="button" data-copy="ics-url">Copy</button>
                <a class="button" href="${icsUrl.replace(/^https?:/, 'webcal:')}">Subscribe</a>
            </div>
            <form method="post" action="/reminders/ics/regenerate" class="regen">
                <button type="submit" class="secondary">Generate a new address</button>
                <span>The current address stops working immediately.</span>
            </form>
        </section>
        ${mailPanel(ctx, accountUrl)}
        ${!reminders.length ? html`<p class="empty">No reminders yet. Click the ${icon.bell} on any game to add it.</p>` : ''}
        ${upcoming.length ? html`<section class="day"><h2><span>Upcoming</span><small class="count">${upcoming.length}</small></h2>${grid(upcoming, ctx, { showDay: true })}</section>` : ''}
        ${undated.length ? html`<section class="day"><h2><span>No date yet</span><small class="count">${undated.length}</small></h2>${grid(undated, ctx, { showDay: true })}</section>` : ''}
        ${released.length ? html`<section class="day"><h2><span>Released</span><small class="count">${released.length}</small></h2>${grid(released, ctx, { showDay: true })}</section>` : ''}`;
    return layout(ctx, content);
}

export function messagePage(ctx, title, message, status) {
    return layout({ ...ctx, title }, html`<section class="panel"><h2>${title}</h2><p>${message}</p>${status === 401 ? html`<p><a class="button" href="/login${query({ return: ctx.path })}">Log in</a></p>` : ''}</section>`);
}
