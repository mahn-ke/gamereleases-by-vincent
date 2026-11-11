import test from 'node:test';
import assert from 'node:assert/strict';
import * as oidc from 'openid-client';
import { Auth } from '../src/auth.js';
import { openDatabase } from '../src/db.js';
import { testConfig } from './helpers.js';

function setup() {
    const config = testConfig({ oidc: { issuer: 'https://sso.example.test/realms/test', clientId: 'gamereleases-abc', clientSecret: 'x' } });
    const store = openDatabase(':memory:');
    const auth = new Auth({ config, store });
    // Offline provider metadata instead of discovery
    auth.oidcConfig = new oidc.Configuration({
        issuer: config.oidc.issuer,
        authorization_endpoint: `${config.oidc.issuer}/protocol/openid-connect/auth`,
        token_endpoint: `${config.oidc.issuer}/protocol/openid-connect/token`,
    }, config.oidc.clientId, config.oidc.clientSecret);
    return { auth, store };
}

test('silent login asks the provider for prompt=none and remembers it', async () => {
    const { auth, store } = setup();
    const regular = new URL(await auth.loginUrl('/reminders'));
    assert.equal(regular.searchParams.get('prompt'), null);
    const silent = new URL(await auth.loginUrl('/reminders', { silent: true }));
    assert.equal(silent.searchParams.get('prompt'), 'none');
    assert.equal(silent.searchParams.get('redirect_uri'), 'https://gamereleases.example.test/auth/callback');
    assert.equal(store.takeLoginState(silent.searchParams.get('state')).silent, 1);
});

test('a silent attempt needing interaction falls back; other errors fail', async () => {
    const { auth } = setup();
    const silentState = new URL(await auth.loginUrl('/reminders', { silent: true })).searchParams.get('state');
    assert.deepEqual(
        await auth.complete(new URL(`https://gamereleases.example.test/auth/callback?error=login_required&state=${silentState}`)),
        { interactive: true, returnTo: '/reminders' });
    const regularState = new URL(await auth.loginUrl('/')).searchParams.get('state');
    await assert.rejects(auth.complete(new URL(`https://gamereleases.example.test/auth/callback?error=login_required&state=${regularState}`)), /login_required/);
    const deniedState = new URL(await auth.loginUrl('/', { silent: true })).searchParams.get('state');
    await assert.rejects(auth.complete(new URL(`https://gamereleases.example.test/auth/callback?error=access_denied&error_description=Nope&state=${deniedState}`)), /Nope/);
});

test('account console link returns through a silent refresh', () => {
    const { auth } = setup();
    const url = new URL(auth.accountUrl('/reminders'));
    assert.equal(url.origin + url.pathname, 'https://sso.example.test/realms/test/account/');
    assert.equal(url.searchParams.get('referrer'), 'gamereleases-abc');
    assert.equal(url.searchParams.get('referrer_uri'), 'https://gamereleases.example.test/auth/refresh?return=%2Freminders');
});

test('existing databases gain the new user columns with mails enabled', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const { DatabaseSync } = await import('node:sqlite');
    const dir = mkdtempSync(path.join(tmpdir(), 'gamereleases-'));
    try {
        const old = new DatabaseSync(path.join(dir, 'gamereleases.sqlite'));
        old.exec('create table users (id integer primary key, sub text not null unique, username text not null unique, email text, name text, ics_token text not null, created_at integer not null)');
        old.exec("insert into users (sub, username, email, ics_token, created_at) values ('s', 'old', 'old@example.test', 't', 1)");
        old.exec('create table login_states (state text primary key, verifier text not null, return_to text, created_at integer not null)');
        old.close();
        const store = openDatabase(dir);
        const user = store.getUserByUsername('old');
        assert.equal(user.email_notifications, 1);
        assert.equal(user.email_synced_at, null);
        assert.equal(store.upsertUser({ sub: 's', username: 'old', email: 'new@example.test' }).email, 'new@example.test');
        assert.ok(store.getUserByUsername('old').email_synced_at > 0);
        store.close();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
