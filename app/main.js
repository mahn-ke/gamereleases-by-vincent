import { Auth } from './src/auth.js';
import { loadConfig } from './src/config.js';
import { openDatabase } from './src/db.js';
import { IgdbClient } from './src/igdb.js';
import { Notifier, createTransport } from './src/notify.js';
import { createApp } from './src/server.js';
import { Sync } from './src/sync.js';

const config = loadConfig();
const store = openDatabase(config.dataDir);
const igdb = new IgdbClient(config.igdb);
const auth = new Auth({ config, store });
const sync = new Sync({ store, igdb, config });
const notifier = new Notifier({ store, transport: createTransport(config.smtp), sync, config });

if (!auth.configured) console.warn('SSO is not configured (OAUTH_URL / OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET); login is disabled');
else auth.provider().catch(error => console.warn('SSO discovery failed; retrying on next login:', error.message));

const server = createApp({ config, store, igdb, auth }).listen(config.port, () => {
    console.log(`Listening on :${config.port} as ${config.baseUrl}`);
});
sync.start();
notifier.start();

function shutdown() {
    sync.stop();
    notifier.stop();
    server.close(() => {
        store.close();
        process.exit(0);
    });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
