import nodemailer from 'nodemailer';
import { addDays, dayInZone, nextMidnightInZone } from './time.js';
import { escapeHtml } from './html.js';

export function createTransport(smtp) {
    if (!smtp.host || !smtp.from) return null;
    return nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.security === 'force_tls',
        requireTLS: smtp.security === 'starttls',
        ignoreTLS: smtp.security === 'off',
        auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
    });
}

const longDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

export function composeMail({ recipient, day, baseUrl }) {
    const date = longDate.format(new Date(`${day}T00:00:00Z`));
    const count = recipient.games.length;
    const subject = count === 1 ? `Out tomorrow: ${recipient.games[0].name}` : `Out tomorrow: ${count} games you're tracking`;
    const line = game => `${game.name}${game.platforms.length ? ` (${game.platforms.join(' / ')})` : ''}`;
    const text = [
        `Releasing tomorrow, ${date}:`, '',
        ...recipient.games.map(game => `- ${line(game)}${game.url ? `\n  ${game.url}` : ''}`), '',
        `Manage your reminders: ${baseUrl}/reminders`,
    ].join('\n');
    const html = `<p>Releasing tomorrow, <strong>${escapeHtml(date)}</strong>:</p><ul>${recipient.games.map(game =>
        `<li>${game.url ? `<a href="${escapeHtml(game.url)}">${escapeHtml(game.name)}</a>` : escapeHtml(game.name)}${
            game.platforms.length ? ` <span style="color:#666">(${escapeHtml(game.platforms.join(' / '))})</span>` : ''}</li>`).join('')
    }</ul><p><a href="${escapeHtml(baseUrl)}/reminders">Manage your reminders</a></p>`;
    return { subject, text, html };
}

// Sends "releasing tomorrow" mails at 00:00 Europe/Berlin. Each (user, game, day)
// is mailed at most once, so catch-up runs after downtime or failures are safe.
export class Notifier {
    constructor({ store, transport, sync, config, log = console, clock = () => new Date() }) {
        this.store = store;
        this.transport = transport;
        this.sync = sync;
        this.config = config;
        this.log = log;
        this.clock = clock;
    }

    async run() {
        const today = dayInZone(this.clock(), this.config.timeZone);
        if (!this.transport) {
            this.log.warn('Release mails skipped: SMTP_HOST / SMTP_FROM are not set');
            return { sent: 0, failed: 0 };
        }
        try {
            await this.sync?.refreshTracked();
        } catch (error) {
            this.log.error('Refreshing tracked games before mailing failed; using cached dates:', error.message);
        }
        const day = addDays(today, 1);
        let sent = 0;
        let failed = 0;
        for (const recipient of this.store.pendingNotifications(day)) {
            const mail = composeMail({ recipient, day, baseUrl: this.config.baseUrl });
            try {
                await this.transport.sendMail({ from: this.config.smtp.from, to: recipient.email, ...mail });
                this.store.markNotified(recipient.userId, recipient.games.map(game => game.id), day);
                sent++;
            } catch (error) {
                failed++;
                this.log.error(`Release mail to user ${recipient.username} failed:`, error.message);
            }
        }
        if (!failed) this.store.setMeta('last_notify_day', today);
        if (sent || failed) this.log.info(`Release mails for ${day}: ${sent} sent, ${failed} failed`);
        return { sent, failed };
    }

    async runIfDue() {
        const today = dayInZone(this.clock(), this.config.timeZone);
        if (this.store.getMeta('last_notify_day') === today) return null;
        return this.run();
    }

    start() {
        const safe = () => this.runIfDue().catch(error => this.log.error('Release mails failed:', error.message));
        const scheduleMidnight = () => {
            const delay = nextMidnightInZone(this.clock(), this.config.timeZone) - this.clock();
            this.midnightTimer = setTimeout(() => { safe(); scheduleMidnight(); }, Math.max(1000, delay + 1000));
            this.midnightTimer.unref?.();
        };
        safe();
        scheduleMidnight();
        // Retries a failed or missed run during the day
        this.retryTimer = setInterval(safe, 15 * 60 * 1000);
        this.retryTimer.unref?.();
    }

    stop() {
        clearTimeout(this.midnightTimer);
        clearInterval(this.retryTimer);
    }
}
