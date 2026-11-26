// Pure business logic: how many people can work each role in every hour of the week.
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

function analyse({ employees = [], roles = [], fromHour = 8, toHour = 20 }) {
  const counts = {};
  for (const r of roles) counts[r.name] = Array.from({ length: 7 }, () => Array(24).fill(0));

  const notSubmitted = [];
  for (const e of employees) {
    if (!e.submitted) { notSubmitted.push({ id: e.id, name: e.name }); continue; }
    for (const slot of e.availability) {
      for (let h = 0; h < 24; h++) {
        if (toMin(slot.start) <= h * 60 && toMin(slot.end) >= (h + 1) * 60) {
          for (const role of e.roles) if (counts[role]) counts[role][slot.day][h] += 1;
        }
      }
    }
  }

  const gaps = [];
  for (const r of roles) {
    for (let day = 0; day < 7; day++) {
      for (let hour = fromHour; hour < toHour; hour++) {
        const available = counts[r.name][day][hour];
        if (available === 0 || available < r.minHeadcount) {
          gaps.push({ role: r.name, day, hour, available, minimum: r.minHeadcount });
        }
      }
    }
  }
  return { window: { fromHour, toHour }, counts, gaps, notSubmitted };
}
module.exports = { analyse };
