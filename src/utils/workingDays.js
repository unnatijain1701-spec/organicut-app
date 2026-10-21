// Counts how many days in [from, to] (both inclusive, 'YYYY-MM-DD' strings) a plant was
// actually expected to work — excluding its configured weekly off-day and, if it opts
// into the shared calendar, national holidays. Used wherever a "days recorded X / Y"
// or month-end projection denominator needs to mean "days this plant could have
// recorded", not "every calendar day" (a plant closed every Sunday should never show
// Sundays as "missing").
function countWorkingDays(fromISO, toISO, weeklyOffDay, holidaySet) {
  const from = new Date(fromISO + 'T00:00:00');
  const to = new Date(toISO + 'T00:00:00');
  if (isNaN(from) || isNaN(to) || from > to) return 0;
  let count = 0;
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    if (weeklyOffDay != null && d.getDay() === weeklyOffDay) continue;
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (holidaySet && holidaySet.has(iso)) continue;
    count++;
  }
  return count;
}

module.exports = { countWorkingDays };
