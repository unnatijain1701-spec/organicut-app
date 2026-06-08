// Run with: node src/db/setup.js
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs   = require('fs');
const path = require('path');
const pool = require('./index');

async function setup() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('Database schema created / verified.');
    process.exit(0);
  } catch (e) {
    console.error('Schema setup failed:', e.message);
    process.exit(1);
  }
}

setup();
