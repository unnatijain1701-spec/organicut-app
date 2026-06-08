// Server-side port of the browser CSV parser in organicut-mpk.html

const HEADER_SIGNALS = ['contractor','employee','day count','attendance','work station','in time','out time'];

function isHeaderRow(fields) {
  const joined = fields.join(' ').toLowerCase();
  return HEADER_SIGNALS.filter(s => joined.includes(s)).length >= 2;
}

function splitLine(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { fields.push(cur); cur = ''; }
    else { cur += ch; }
  }
  fields.push(cur);
  return fields;
}

function parseCSVText(text) {
  text = text.replace(/^﻿/, ''); // strip BOM
  const lines = text.split(/\r?\n/);

  let headerIdx = -1;
  for (let i = 0; i < Math.min(15, lines.length); i++) {
    if (isHeaderRow(splitLine(lines[i]))) { headerIdx = i; break; }
  }
  if (headerIdx < 0) throw new Error('Could not find header row in CSV file');

  const headers = splitLine(lines[headerIdx]).map(h => h.trim());
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const fields = splitLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = (fields[idx] || '').trim(); });
    rows.push(row);
  }
  return { rows, headers };
}

function col(row, ...names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== '') return row[name];
  }
  const keys = Object.keys(row);
  for (const name of names) {
    const lo = name.toLowerCase();
    const found = keys.find(k => k.toLowerCase() === lo);
    if (found !== undefined && row[found] !== '') return row[found];
  }
  return '';
}

function mapContractor(raw) {
  const u = (raw || '').trim().toUpperCase();
  if (u.includes('KRISH'))    return 'Krish Enterprises';
  if (u.includes('SAI'))      return 'Sai Enterprises';
  if (u.includes('SATENDRA') || u.includes('BHADORIYA')) return 'SATENDRA SINGH Bhadoriya';
  return null;
}

/**
 * Parse a CSV buffer/string and return attendance data for the given date.
 * If filterDate is null/missing, the latest date in the file is used.
 */
function processCSV(text, filterDate) {
  const { rows } = parseCSVText(text);

  const datesInCSV = new Set();
  rows.forEach(row => {
    const d = col(row, 'Attendance Date').trim();
    if (d) datesInCSV.add(d);
  });

  const sortedDates = [...datesInCSV].sort();
  const effectiveDate = (filterDate && datesInCSV.has(filterDate))
    ? filterDate
    : sortedDates[sortedDates.length - 1];

  const byContractor = {};
  const unmappedNames = new Set();
  let totalRows = 0;

  rows.forEach(row => {
    const rowDate = col(row, 'Attendance Date').trim();
    if (datesInCSV.size > 1 && effectiveDate && rowDate !== effectiveDate) return;

    totalRows++;
    const contractorRaw = col(row, 'Contractor Name', 'Contractor');
    const contractor = mapContractor(contractorRaw);
    if (!contractor) {
      const raw = (contractorRaw || '').trim();
      if (raw && raw.toUpperCase() !== 'VENDOR') unmappedNames.add(raw);
      return;
    }

    const ws = parseFloat(col(row, 'Work Station', 'workstation', 'Work station')) || 0;
    const dc = parseFloat(col(row, 'Day Count', 'daycount', 'Day count')) || 0;

    if (!byContractor[contractor]) {
      byContractor[contractor] = { workers: 0, totalCost: 0 };
    }
    byContractor[contractor].workers++;
    byContractor[contractor].totalCost += ws * dc;
  });

  return {
    date: effectiveDate,
    sortedDates,
    byContractor,
    unmapped: unmappedNames.size,
    unmappedNames: [...unmappedNames],
    totalRows,
  };
}

module.exports = { processCSV };
