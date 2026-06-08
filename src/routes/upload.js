const express = require('express');
const multer  = require('multer');
const { processCSV } = require('../utils/csvParser');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) cb(null, true);
    else cb(new Error('Only CSV files are accepted'));
  },
});

// POST /api/upload/csv
router.post('/csv', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const text = req.file.buffer.toString('utf-8');
    const filterDate = (req.body.date || '').trim() || null;
    const result = processCSV(text, filterDate);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
