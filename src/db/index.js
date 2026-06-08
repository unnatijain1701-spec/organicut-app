const { Pool } = require('pg');

// Railway (and most cloud providers) supply DATABASE_URL.
// Fall back to individual vars for local dev.
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // required by Railway's managed Postgres
    })
  : new Pool({
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME     || 'organicut',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD,
    });

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

module.exports = pool;
