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

  // Different plants' biometric devices don't agree on date order for an ambiguous
  // cell like "9/2/2026" — some mean D/M (9 Feb), some mean M/D (Sept 2). There's no
  // single hardcoded rule that's right for every device. So: parse every row BOTH
  // ways, then let filterDate — the date the operator already has selected in the
  // app — decide which convention this particular file actually uses. Only fall back
  // to a hardcoded default (day-first) when there's no filterDate to disambiguate with.
  const rowISO_dayFirst   = dataRows.map(r => col.date !== -1 ? parseDateToISO((r[col.date] || '').trim(), false) : null);
  const rowISO_monthFirst = dataRows.map(r => col.date !== -1 ? parseDateToISO((r[col.date] || '').trim(), true)  : null);

  let rowISO = rowISO_dayFirst;
  if (filterDate && !rowISO_dayFirst.includes(filterDate) && rowISO_monthFirst.includes(filterDate)) {
    rowISO = rowISO_monthFirst;
  }

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
//   DD-MM-YYYY / D-M-YYYY   (dashes)
//   DD/MM/YYYY / D/M/YYYY   (slashes)
//   YYYY-MM-DD (already ISO)
//   2-digit years (26 -> 2026)
// When a field is unambiguous (one part > 12), that part is always the day, regardless
// of the preferMonthFirst flag. Only the truly ambiguous case (both parts <= 12) is
// affected by preferMonthFirst — callers try both and pick whichever matches context.
function parseDateToISO(raw, preferMonthFirst) {
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
    else if (preferMonthFirst) { M = a; D = b; }  // ambiguous — try month-first (US)
    else              { D = a; M = b; }    // ambiguous — try day-first (India)
  }
  if (!Y || !M || !D || M < 1 || M > 12 || D < 1 || D > 31) return null;
  const pad = n => String(n).padStart(2, '0');
  return `${Y}-${pad(M)}-${pad(D)}`;
}

module.exports = { processCSV };
