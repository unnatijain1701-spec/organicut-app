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

  // Collect all dates present in the file
  const allDates = new Set();
  if (col.date !== -1) {
    dataRows.forEach(r => {
      const d = (r[col.date] || '').trim();
      if (d) allDates.add(d);
    });
  }

  // CSV dates are DD-MM-YYYY; convert to YYYY-MM-DD for the frontend
  const toISO = s => {
    const p = s.split('-');
    if (p.length === 3 && p[0].length === 2) return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
    return s;
  };
  // Convert YYYY-MM-DD filterDate back to DD-MM-YYYY for matching
  const toCSV = s => {
    const p = s.split('-');
    if (p.length === 3 && p[0].length === 4) return `${p[2]}-${p[1]}-${p[0]}`;
    return s;
  };

  const sortedDates = [...allDates].sort((a, b) => {
    const parse = s => { const p = s.split('-'); return p[0].length === 2 ? new Date(p[2],p[1]-1,p[0]) : new Date(s); };
    return parse(a) - parse(b);
  }).map(toISO);

  // Determine which date to use
  let activeCSVDate = null;
  if (filterDate) {
    const candidate = toCSV(filterDate);
    if (allDates.has(candidate)) activeCSVDate = candidate;
  }
  if (!activeCSVDate && allDates.size > 0) {
    // Default to last date in the file
    activeCSVDate = [...allDates].sort((a, b) => {
      const p = s => { const q = s.split('-'); return q[0].length === 2 ? new Date(q[2],q[1]-1,q[0]) : new Date(s); };
      return p(a) - p(b);
    }).pop();
  }

  // Filter rows to the active date
  const filtered = activeCSVDate
    ? dataRows.filter(r => (r[col.date] || '').trim() === activeCSVDate)
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
    date:        activeCSVDate ? toISO(activeCSVDate) : null,
    sortedDates,
    totalRows:   filtered.length,
    unmapped:    0,
    unmappedNames: [],
  };
}

module.exports = { processCSV };
