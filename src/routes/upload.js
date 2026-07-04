const express = require('express');
const multer  = require('multer');
const XLSX    = require('xlsx');
const { processCSV } = require('../utils/csvParser');

const router = express.Router();
const CSV_MIMETYPES = new Set([
  'text/csv', 'application/csv', 'text/plain',
  'application/vnd.ms-excel',            // Excel-exported CSVs often use this
  'application/octet-stream',            // some browsers send this for .csv
]);
const XLSX_MIMETYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel',            // .xls (also legacy CSV — resolved by extension below)
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name  = file.originalname.toLowerCase();
    const isCsv  = CSV_MIMETYPES.has(file.mimetype) || name.endsWith('.csv');
    const isXlsx = XLSX_MIMETYPES.has(file.mimetype) || name.endsWith('.xlsx') || name.endsWith('.xls');
    if (isCsv || isXlsx) cb(null, true);
    else cb(new Error('Only CSV or Excel (.xlsx/.xls) files are accepted.'));
  },
});

// Detect an Excel file by extension (preferred — mimetype is unreliable)
function isExcelFile(file) {
  const name = (file.originalname || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return true;
  if (name.endsWith('.csv')) return false;
  // Fall back to mimetype only when the extension is inconclusive
  return file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

// Convert an Excel buffer to CSV text (first sheet) so the existing parser can read it
function excelBufferToCSV(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) throw new Error('The Excel file has no sheets.');
  const sheet = wb.Sheets[firstSheetName];
  // FS: ',' keeps CSV format; blankrows preserved so header-row detection still works
  return XLSX.utils.sheet_to_csv(sheet, { FS: ',', blankrows: true });
}

// POST /api/upload/csv
router.post('/csv', (req, res) => {
  upload.single('file')(req, res, (err) => {
    // multer errors (bad type, too large) land here — return a clear 400, not a 500
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large (max 20 MB).'
        : err.message || 'Upload failed.';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
      const text = isExcelFile(req.file)
        ? excelBufferToCSV(req.file.buffer)
        : req.file.buffer.toString('utf-8');
      const filterDate = (req.body.date || '').trim() || null;
      const result = processCSV(text, filterDate);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
});

module.exports = router;
