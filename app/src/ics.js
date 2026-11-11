import ical from 'ical-generator';

const REFRESH_SECONDS = 6 * 60 * 60;

export function buildCalendar({ entries, username, baseUrl }) {
    const host = new URL(baseUrl).host;
    const cal = ical({
        name: `Game releases (${username})`,
        prodId: { company: host, product: 'gamereleases', language: 'EN' },
        // Emits REFRESH-INTERVAL and X-PUBLISHED-TTL so subscribed clients poll regularly
        ttl: REFRESH_SECONDS,
    });
    for (const entry of entries) {
        const platforms = entry.platforms.join(' / ');
        cal.createEvent({
            id: `${entry.id}-${entry.day}@${host}`,
            start: new Date(`${entry.day}T00:00:00Z`),
            allDay: true,
            summary: platforms ? `${entry.name} (${platforms})` : entry.name,
            description: entry.url ?? undefined,
            url: entry.url ?? undefined,
        });
    }
    return cal.toString();
}
