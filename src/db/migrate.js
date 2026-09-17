const fs = require('fs');
const path = require('path');
const db = require('./index');

// Tracks which migration files have already been run, so each one fires
// exactly once, ever — never again on a later restart or redeploy. This is
// what schema.sql could never do: it re-ran its entire contents on every
// boot, which is how a one-time vendor seed once fired a second time
// against a brand-new plant that happened to share an old plant's name.
async function ensureMigrationsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(200) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function runMigrations() {
  await ensureMigrationsTable();

  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

  const { rows } = await db.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map(r => r.filename));

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Migration applied: ${file}`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`Migration FAILED: ${file} — ${e.message}`);
      throw e;
    } finally {
      client.release();
    }
  }
}

module.exports = { runMigrations };
