import fs from 'node:fs';
import { loadConfig } from '../config.ts';
import { createDb, migrateToLatest } from './index.ts';
import { seed } from './seed.ts';

/**
 * `npm run db:setup`  — apply migrations; load the development data if the database is empty.
 * `npm run db:reset`  — delete the local database file first, then set up again.
 *
 * The development data is the real, source-based CUTM events (seed-cutm.ts).
 * Add `-- --with-samples` to also load the fictional sample events that
 * exercise every feature (registration, waitlist, teams, payments, check-in…),
 * e.g. `npm run db:reset -w server -- --with-samples`.
 */
const config = loadConfig();
if (process.env.NODE_ENV === 'production') {
  throw new Error('db:setup loads development sample data and must not run in production.');
}

if (process.argv.includes('--reset')) {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(config.dbPath + suffix, { force: true });
  console.log('Deleted local database.');
}

const db = createDb(config.dbPath);
const applied = await migrateToLatest(db);
console.log(`Migrations: ${applied.length ? applied.map(r => r.migrationName).join(', ') : 'up to date'}`);

const { n } = await db.selectFrom('users').select(eb => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
if (Number(n) === 0) {
  const samples = process.argv.includes('--with-samples');
  await seed(db, new Date(), { cutm: true, samples });
  console.log(`Loaded the CUTM events${samples ? ' and the fictional sample events' : ''}.`);
} else {
  console.log('Database already has data; sample data not reloaded (use npm run db:reset).');
}
await db.destroy();
