// Builds an iCalendar (.ics) file that Google Calendar, Apple Calendar and Outlook can import.
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const stamp = (date, time) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`; // floating local time

function buildICS(calendarName, shifts, now = new Date()) {
  const dtstamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Staff Shift Scheduler//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(calendarName)}`];
  for (const s of shifts) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${s.id}@staff-shift-scheduler`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(s.date, s.start)}`,
      `DTEND:${stamp(s.date, s.end)}`,
      `SUMMARY:${esc(s.title || 'Shift')} - ${esc(s.role)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
module.exports = { buildICS };
