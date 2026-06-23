// Run with: node src/db/setup.js
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs   = require('fs');
const path = require('path');
const pool = require('./index');

async function setup() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  // Split into individual statements so one failure doesn't block the rest
  const statements = sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  let errors = 0;
  for (const stmt of statements) {
    try {
      await pool.query(stmt);
    } catch (e) {
      console.error('Schema statement failed:', e.message);
      console.error('Statement:', stmt.slice(0, 120));
      errors++;
    }
  }
  if (errors === 0) {
    console.log('Database schema created / verified.');
  } else {
    console.log(`Schema completed with ${errors} error(s) — check logs above.`);
  }
  process.exit(0);
}

setup();
