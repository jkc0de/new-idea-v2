'use strict';
const http = require('node:http');
const path = require('node:path');
const { openDb } = require('./lib/db');
const { createApp } = require('./lib/app');

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'booking.db');

const db = openDb(DB_FILE);
const app = createApp(db, { secureCookies: process.env.SECURE_COOKIES === '1' });

// Morning summaries: check every minute; each studio gets one at its chosen hour.
setInterval(() => app.runDigests().catch((e) => console.error('Digest failed:', e.message)), 60_000).unref();

http.createServer(app).listen(PORT, () => {
  console.log(`Massage booking running at http://localhost:${PORT}`);
  console.log(`  Owner dashboard: http://localhost:${PORT}/admin`);
});
