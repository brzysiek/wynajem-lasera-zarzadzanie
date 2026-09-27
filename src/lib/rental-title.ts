// Leading "HH:MM " pattern left by a previous call to withDeliveryTimePrefix
// — stripped before re-prefixing so the result stays correct (not doubled)
// across repeated saves, and even after a round trip through Google Calendar
// (device-sync pulls the event summary — prefix included — back into
// rental.title on every sync).
const TIME_PREFIX_RE = /^\d{2}:\d{2} /;

// The calendar event's name gets the delivery time prefixed onto the
// rental's title (e.g. "14:30 Wesele Kowalskich") whenever a delivery time
// is set, so the crew can see the delivery hour without opening the event.
export function withDeliveryTimePrefix(title: string, deliveryTime: string | null | undefined): string {
  const bareTitle = title.replace(TIME_PREFIX_RE, "");
  if (!deliveryTime) return bareTitle;
  return `${deliveryTime} ${bareTitle}`;
}

// Godzina dostawy wynajmu do pokazania (karta klienta): pole deliveryTime,
// albo prefiks „10:00 ” z tytułu (także z kalendarza), albo godzina startu —
// ale tylko dla wydarzeń z godziną. Wynajmy całodniowe są zapisane
// o 12:00 UTC (google-calendar.ts), więc bez godziny zwracamy null
// („godz. do ustalenia”), nigdy „14:00”.
export function rentalTimeOf(r: { deliveryTime?: string | null; title?: string | null; startsAt: Date }): string | null {
  const norm = (h: string, m: string) => `${h.padStart(2, "0")}:${m}`;
  const d = r.deliveryTime?.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (d) return norm(d[1], d[2]);
  const t = r.title?.trim().match(/^(\d{1,2})[:.](\d{2})\b/);
  if (t && Number(t[1]) < 24) return norm(t[1], t[2]);
  if (r.startsAt.getUTCHours() === 12 && r.startsAt.getUTCMinutes() === 0) return null;
  return new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit" }).format(r.startsAt);
}
