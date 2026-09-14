const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { createDatabase } = require('./database.cjs');
async function migrate(db) {
  await db.query('CREATE TABLE IF NOT EXISTS lumen_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  await db.transaction(async tx => {
    await tx.query('LOCK TABLE lumen_migrations IN EXCLUSIVE MODE');
    for (const name of readdirSync(join(__dirname, 'migrations')).filter(n => n.endsWith('.sql')).sort()) {
      if ((await tx.query('SELECT name FROM lumen_migrations WHERE name=$1', [name])).rows.length) continue;
      await tx.query(readFileSync(join(__dirname, 'migrations', name), 'utf8'));
      await tx.query('INSERT INTO lumen_migrations(name) VALUES($1)', [name]);
    }
  });
}
if (require.main === module) {
  const db = createDatabase(process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL);
  if (!db) { console.error('DATABASE_URL is required'); process.exitCode = 1; }
  else migrate(db).then(() => console.log('Database migrations complete')).catch(() => { console.error('Database migration failed; check connectivity and migration permissions'); process.exitCode = 1; }).finally(() => db.close());
}
module.exports = { migrate };
