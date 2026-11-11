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

    async loginUrl(returnTo) {
        const provider = await this.provider();
        const state = oidc.randomState();
        const verifier = oidc.randomPKCECodeVerifier();
        this.store.saveLoginState(state, verifier, safeReturnPath(returnTo));
        return oidc.buildAuthorizationUrl(provider, {
            redirect_uri: this.redirectUri,
            scope: 'openid profile email',
            state,
            code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
            code_challenge_method: 'S256',
        }).href;
    }

    // Returns { user, idToken, returnTo } for a completed authorization code flow
    async complete(callbackUrl) {
        const provider = await this.provider();
        const state = callbackUrl.searchParams.get('state');
        const pending = state ? this.store.takeLoginState(state) : null;
        if (!pending) throw new Error('Login expired or was started elsewhere; please try again');
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
