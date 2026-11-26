const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const overlaps = (a, b) => a.date === b.date && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);
const dayOfWeek = (date) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);
const weekStartOf = (date) => addDays(date, -((dayOfWeek(date) + 6) % 7)); // Monday
module.exports = { toMin, overlaps, dayOfWeek, addDays, today, weekStartOf };
