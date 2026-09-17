require('dotenv').config();
const express      = require('express');
const path         = require('path');
const cookieParser = require('cookie-parser');

const authRoutes    = require('./src/routes/auth');
const recordRoutes  = require('./src/routes/records');
const uploadRoutes  = require('./src/routes/upload');
const skuRoutes     = require('./src/routes/sku');
const vendorRoutes  = require('./src/routes/vendors');
const { authenticateToken } = require('./src/middleware/auth');
const { runMigrations } = require('./src/db/migrate');

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
  await runMigrations();
  console.log('Database migrations up to date.');

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\n  Organicut server → http://localhost:${PORT}\n`);
  });
}

start().catch(err => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});
