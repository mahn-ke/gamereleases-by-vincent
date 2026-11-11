import * as oidc from 'openid-client';

export function safeReturnPath(value) {
    return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/';
}

// Usernames end up in public calendar URLs: keep them URL- and filename-safe
export function usernameFromClaims(claims) {
    const source = claims.preferred_username || (claims.email ? claims.email.split('@')[0] : '') || claims.sub;
    const cleaned = String(source).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 40);
    return cleaned || 'user';
}

// Errors with which an OIDC provider answers prompt=none when it cannot respond silently
const INTERACTION_ERRORS = new Set(['login_required', 'interaction_required', 'consent_required', 'account_selection_required']);

export class Auth {
    constructor({ config, store, log = console }) {
        this.config = config;
        this.store = store;
        this.log = log;
        this.oidcConfig = null;
    }

    get configured() {
        const { issuer, clientId, clientSecret } = this.config.oidc;
        return Boolean(issuer && clientId && clientSecret);
    }

    get redirectUri() {
        return `${this.config.baseUrl}/auth/callback`;
    }

    // Discovery is retried lazily so an SSO outage at startup does not disable login
    async provider() {
        if (this.oidcConfig) return this.oidcConfig;
        const { issuer, clientId, clientSecret } = this.config.oidc;
        const options = issuer.startsWith('http://') ? { execute: [oidc.allowInsecureRequests] } : undefined;
        this.oidcConfig = await oidc.discovery(new URL(issuer), clientId, clientSecret, undefined, options);
        return this.oidcConfig;
    }

    // Keycloak's account console, where users change their email; its "back" link
    // returns to /auth/refresh, which re-reads the profile into this app
    accountUrl(returnTo = '/reminders') {
        const url = new URL(`${this.config.oidc.issuer.replace(/\/$/, '')}/account/`);
        url.searchParams.set('referrer', this.config.oidc.clientId);
        url.searchParams.set('referrer_uri', `${this.config.baseUrl}/auth/refresh?return=${encodeURIComponent(safeReturnPath(returnTo))}`);
        return url.href;
    }

    // `silent` uses prompt=none: with an active SSO session the provider answers
    // immediately with a fresh ID token, so profile changes (e.g. email) sync without a login screen
    async loginUrl(returnTo, { silent = false } = {}) {
        const provider = await this.provider();
        const state = oidc.randomState();
        const verifier = oidc.randomPKCECodeVerifier();
        this.store.saveLoginState(state, verifier, safeReturnPath(returnTo), silent);
        const parameters = {
            redirect_uri: this.redirectUri,
            scope: 'openid profile email',
            state,
            code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
            code_challenge_method: 'S256',
        };
        if (silent) parameters.prompt = 'none';
        return oidc.buildAuthorizationUrl(provider, parameters).href;
    }

    // Returns { user, idToken, returnTo } for a completed authorization code flow, or
    // { interactive: true, returnTo } when a silent attempt needs a regular login instead
    async complete(callbackUrl) {
        const state = callbackUrl.searchParams.get('state');
        const pending = state ? this.store.takeLoginState(state) : null;
        if (!pending) throw new Error('Login expired or was started elsewhere; please try again');
        const error = callbackUrl.searchParams.get('error');
        if (error) {
            if (pending.silent && INTERACTION_ERRORS.has(error)) return { interactive: true, returnTo: pending.return_to || '/' };
            throw new Error(callbackUrl.searchParams.get('error_description') || `Login failed: ${error}`);
        }
        const provider = await this.provider();
        const tokens = await oidc.authorizationCodeGrant(provider, callbackUrl, {
            pkceCodeVerifier: pending.verifier,
            expectedState: state,
        });
        const claims = tokens.claims();
        const user = this.store.upsertUser({
            sub: claims.sub,
            username: usernameFromClaims(claims),
            email: claims.email,
            name: claims.name || claims.preferred_username,
        });
        return { user, idToken: tokens.id_token, returnTo: pending.return_to || '/' };
    }
}
