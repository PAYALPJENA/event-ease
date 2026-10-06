import fs from 'node:fs';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { Migrator } from 'kysely/migration';
import type { Database } from './types.ts';
import { migrations } from './migrations.ts';

export type DB = Kysely<Database>;

/**
 * Opens the SQLite database. Pass ':memory:' for tests.
 *
 * To move to PostgreSQL later, swap SqliteDialect for PostgresDialect here;
 * queries go through Kysely and avoid SQLite-only SQL (see registrations
 * service for the one place that needs a row lock on Postgres).
 */
export const createDb = (dbPath: string): DB => {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const sqlite = new BetterSqlite3(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) });
};

export const migrateToLatest = async (db: DB) => {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => migrations },
  });
  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    if (r.status === 'Error') console.error(`Migration "${r.migrationName}" failed`);
  }
  if (error) throw error;
  return results ?? [];
};
