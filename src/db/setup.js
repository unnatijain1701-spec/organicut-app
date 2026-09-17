// Run with: npm run setup-db   (or: node src/db/setup.js)
// Applies any migrations in src/db/migrations/ that haven't run yet.
// Safe to run any number of times — already-applied migrations are skipped.
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { runMigrations } = require('./migrate');

runMigrations()
  .then(() => {
    console.log('Database migrations up to date.');
    process.exit(0);
  })
  .catch((e) => {
    console.error('Migration run failed:', e.message);
    process.exit(1);
  });
