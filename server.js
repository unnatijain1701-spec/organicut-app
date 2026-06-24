require('dotenv').config();
const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const cookieParser = require('cookie-parser');

const db            = require('./src/db');
const authRoutes    = require('./src/routes/auth');
const recordRoutes  = require('./src/routes/records');
const uploadRoutes  = require('./src/routes/upload');
const skuRoutes     = require('./src/routes/sku');
const vendorRoutes  = require('./src/routes/vendors');
const { authenticateToken } = require('./src/middleware/auth');

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth',    authRoutes);
app.use('/api/records', authenticateToken, recordRoutes);
app.use('/api/upload',  authenticateToken, uploadRoutes);
app.use('/api/sku',     authenticateToken, skuRoutes);
app.use('/api/vendors', authenticateToken, vendorRoutes);

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

async function start() {
  const schema = fs.readFileSync(path.join(__dirname, 'src/db/schema.sql'), 'utf8');
  const statements = schema.split(/;\s*\n/)
    .map(s => s.replace(/--.*$/gm, '').trim())
    .filter(s => s.length > 0);
  for (const stmt of statements) {
    try { await db.query(stmt); }
    catch (e) { console.error('Schema stmt failed:', e.message, '\n', stmt.slice(0, 100)); }
  }
  console.log('Database schema verified.');

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\n  Organicut server → http://localhost:${PORT}\n`);
  });
}

start().catch(err => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});
