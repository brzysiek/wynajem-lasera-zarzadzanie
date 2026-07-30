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
