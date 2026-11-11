// Calendar-day helpers. Days are ISO strings (YYYY-MM-DD); release days are UTC
// calendar days as published by IGDB, notification days follow Europe/Berlin.

const formatters = new Map();

function formatter(timeZone) {
    if (!formatters.has(timeZone)) {
        formatters.set(timeZone, new Intl.DateTimeFormat('en-CA', {
            timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
        }));
    }
    return formatters.get(timeZone);
}

function zonedParts(date, timeZone) {
    const parts = Object.fromEntries(formatter(timeZone).formatToParts(date).map(p => [p.type, p.value]));
    return {
        year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
        hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
    };
}

export function dayInZone(date, timeZone) {
    const { year, month, day } = zonedParts(date, timeZone);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function utcDay(unixSeconds) {
    return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export function addDays(day, count) {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + count);
    return date.toISOString().slice(0, 10);
}

export function dayToUnix(day) {
    return Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
}

export function isDay(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
        && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

// The instant at which `day` starts in `timeZone`
export function startOfDayInZone(day, timeZone) {
    const target = Date.parse(`${day}T00:00:00Z`);
    let guess = target;
    // Two passes settle the offset; midnight is never inside a DST gap in Europe/Berlin
    for (let i = 0; i < 2; i++) {
        const p = zonedParts(new Date(guess), timeZone);
        const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
        guess += target - asUtc;
    }
    return new Date(guess);
}

export function nextMidnightInZone(now, timeZone) {
    return startOfDayInZone(addDays(dayInZone(now, timeZone), 1), timeZone);
}

const longDay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
const shortDay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

export function dayLabel(day, today) {
    if (day === today) return 'Today';
    if (day === addDays(today, 1)) return 'Tomorrow';
    if (day === addDays(today, -1)) return 'Yesterday';
    return longDay.format(new Date(`${day}T00:00:00Z`));
}

export function shortDayLabel(day) {
    const date = new Date(`${day}T00:00:00Z`);
    const n = date.getUTCDate();
    const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
    return `${shortDay.format(date)}${suffix}`;
}
