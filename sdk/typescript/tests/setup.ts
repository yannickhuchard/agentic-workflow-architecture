/**
 * Tests work on a private copy of the development database, so running the
 * suite never changes the database file kept in the repository.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

if (!process.env.AWA_DATABASE_URL) {
    const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'awa-test-db-')), 'awa.db');
    fs.copyFileSync(path.resolve(__dirname, '../prisma/awa.db'), copy);
    process.env.AWA_DATABASE_URL = `file:${copy}`;
}
