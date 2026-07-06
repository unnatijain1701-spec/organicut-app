/**
 * Processes a biometric attendance CSV and returns all contractors found,
 * with worker count and total cost per contractor.
 *
 * CSV format expected:
 *   Row 1:  Organization header (ignored)
 *   Row 2:  Blank (ignored)
 *   Row 3:  Column headers — must include "Contractor Name", "Work Station",
 *           "Attendance Date", "Day Count"
 *   Row 4+: Data rows
 *
 * Wage per worker = Work Station (daily rate) × Day Count
 * Workers counted = rows where Day Count > 0 (present workers only)
 */

function processCSV(text, filterDate) {
  const rows = text.split(/\r?\n/).map(line => line.split(','));

  // Find the header row by looking for "Employee Name" and "Contractor Name"
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const lower = rows[i].map(c => (c || '').trim().toLowerCase());
    if (lower.includes('employee name') && lower.some(c => c.includes('contractor name'))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) throw new Error('Could not find header row — expected columns: Employee Name, Contractor Name, Work Station, Day Count');

  const headers = rows[headerIdx].map(h => (h || '').trim().toLowerCase());
  const col = {
    contractor:  headers.findIndex(h => h.includes('contractor name')),
    workStation: headers.findIndex(h => h.includes('work station')),
    date:        headers.findIndex(h => h.includes('attendance date')),
    dayCount:    headers.findIndex(h => h.includes('day count')),
    designation: headers.findIndex(h => h.includes('designation')),
  };

  if (col.contractor === -1) throw new Error('CSV missing "Contractor Name" column');
  if (col.dayCount   === -1) throw new Error('CSV missing "Day Count" column');

  // Pull all data rows that have a non-empty contractor name
  const dataRows = rows.slice(headerIdx + 1).filter(r =>
    r.length > col.contractor && (r[col.contractor] || '').trim()
  );

  // Normalise every row's Attendance Date to canonical ISO (YYYY-MM-DD).
  // rowISO[i] holds the ISO date for dataRows[i]; allDates is the set of ISO dates.
  const rowISO = dataRows.map(r => col.date !== -1 ? parseDateToISO((r[col.date] || '').trim()) : null);
  const allDates = new Set(rowISO.filter(Boolean));

  // Sorted unique ISO dates (ascending) — ISO strings sort chronologically as text
  const sortedDates = [...allDates].sort();

  // Determine which date to use. filterDate arrives from the frontend already as ISO.
  let activeCSVDate = null;
  if (filterDate && allDates.has(filterDate)) activeCSVDate = filterDate;
  if (!activeCSVDate && sortedDates.length > 0) activeCSVDate = sortedDates[sortedDates.length - 1]; // latest

  // Filter rows to the active date (compare on normalised ISO, not raw text)
  const filtered = activeCSVDate
    ? dataRows.filter((r, i) => rowISO[i] === activeCSVDate)
    : dataRows;

  // Group by contractor (and designation within each contractor)
  const byContractor = {};
  filtered.forEach(r => {
    const contractor  = (r[col.contractor] || '').trim();
    if (!contractor) return;

    const wage        = col.workStation !== -1 ? (parseFloat(r[col.workStation]) || 0) : 0;
    const dayCount    = parseFloat(r[col.dayCount]) || 0;
    const cost        = wage * dayCount;
    const designation = col.designation !== -1 ? (r[col.designation] || '').trim() : '';

    if (!byContractor[contractor]) byContractor[contractor] = { workers: 0, totalCost: 0, designations: {} };
    if (dayCount > 0) {
      byContractor[contractor].workers++;
      if (designation) {
        if (!byContractor[contractor].designations[designation])
          byContractor[contractor].designations[designation] = { workers: 0, totalCost: 0 };
        byContractor[contractor].designations[designation].workers++;
        byContractor[contractor].designations[designation].totalCost =
          Math.round((byContractor[contractor].designations[designation].totalCost + cost) * 100) / 100;
      }
    }
    byContractor[contractor].totalCost = Math.round((byContractor[contractor].totalCost + cost) * 100) / 100;
  });

  return {
    byContractor,
    date:        activeCSVDate || null,
    sortedDates,
    totalRows:   filtered.length,
    unmapped:    0,
    unmappedNames: [],
  };
}

// Parse a date cell into canonical ISO (YYYY-MM-DD). Handles:
//   DD-MM-YYYY / D-M-YYYY   (dashes, Indian)   -> e.g. 05-07-2026
//   M/D/YYYY   / D/M/YYYY   (slashes)          -> e.g. 7/5/2026
//   YYYY-MM-DD (already ISO)
//   2-digit years (26 -> 2026)
// When day and month are both <= 12 (ambiguous), the separator decides:
//   '/' -> US M/D/YYYY,  '-' -> Indian D-M-YYYY.
function parseDateToISO(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const sep = s.includes('/') ? '/' : (s.includes('-') ? '-' : null);
  if (!sep) return null;
  const parts = s.split(sep).map(p => p.trim());
  if (parts.length !== 3) return null;

  let Y, M, D;
  if (parts[0].length === 4) {            // YYYY-MM-DD
    Y = +parts[0]; M = +parts[1]; D = +parts[2];
  } else {
    let a = +parts[0], b = +parts[1];
    Y = +parts[2];
    if (Y < 100) Y += 2000;               // 2-digit year -> 20YY
    if (a > 12)       { D = a; M = b; }    // first field must be the day
    else if (b > 12)  { M = a; D = b; }    // second field must be the day
    else              { if (sep === '/') { M = a; D = b; } else { D = a; M = b; } }
  }
  if (!Y || !M || !D || M < 1 || M > 12 || D < 1 || D > 31) return null;
  const pad = n => String(n).padStart(2, '0');
  return `${Y}-${pad(M)}-${pad(D)}`;
}

module.exports = { processCSV };
