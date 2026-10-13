/** Calendar day used for deadlines and reminders, independent of the host time zone. */
export function berlinDay(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(now);
}
