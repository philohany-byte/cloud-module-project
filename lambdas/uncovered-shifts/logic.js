// Pure business logic: compare each shift's assigned staff with its role requirements.
function findUncovered({ shifts = [] }) {
  const uncovered = [];
  for (const s of shifts) {
    if (s.status === 'cancelled') continue;
    for (const [role, required] of Object.entries(s.requirements)) {
      const assigned = s.assigned.filter((a) => a.role === role).length;
      if (assigned < required) {
        uncovered.push({ shiftId: s.id, date: s.date, start: s.start, end: s.end, title: s.title, role, required, assigned, missing: required - assigned });
      }
    }
  }
  uncovered.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return { checked: shifts.length, uncovered };
}
module.exports = { findUncovered };
