import path from 'node:path';

const SMTP_SECURITY_MODES = new Set(['starttls', 'force_tls', 'off']);

export function loadConfig(env = process.env) {
    const baseUrl = new URL(env.APP_BASE_URL || 'https://gamereleases.by.vincent.mahn.ke');
    const smtpSecurity = (env.SMTP_SECURITY || 'starttls').toLowerCase();
    if (!SMTP_SECURITY_MODES.has(smtpSecurity)) {
        throw new Error(`SMTP_SECURITY must be one of ${[...SMTP_SECURITY_MODES].join(', ')}`);
    }
    return {
        port: Number(env.PORT || 3000),
        baseUrl: baseUrl.origin,
        dataDir: env.DATA_DIR || path.join(process.cwd(), 'data'),
        timeZone: 'Europe/Berlin',
        oidc: {
            issuer: env.OAUTH_URL || '',
            clientId: env.OAUTH_CLIENT_ID || '',
            clientSecret: env.OAUTH_CLIENT_SECRET || '',
            providerName: env.OAUTH_NAME || 'SSO',
        },
        igdb: {
            clientId: env.TWITCH_CLIENT_ID || '',
            clientSecret: env.TWITCH_CLIENT_SECRET || '',
        },
        smtp: {
            host: env.SMTP_HOST || '',
            port: Number(env.SMTP_PORT || 587),
            security: smtpSecurity,
            username: env.SMTP_USERNAME || '',
            password: env.SMTP_PASSWORD || '',
            from: env.SMTP_FROM || '',
        },
        // Sync window around today; tracked games are always refreshed regardless
        syncDaysBack: 14,
        syncDaysAhead: 180,
        syncIntervalMs: 6 * 60 * 60 * 1000,
    };
}
