import { prisma } from "@/lib/prisma";
import { dayIdx, idxToYmd, nearestFreeStarts, overlaps, spanOf, type Span } from "./availability-rules";

// Wniosek 29: kolizje urządzenia — inne rezerwacje tego urządzenia (także
// wydarzenia z Google, bo kalendarz urządzenia = tabela rentals po sync).

export type Conflict = { id: string; title: string; clientName: string | null; od: string; do: string };

async function deviceSpans(deviceId: string, from: number, to: number, excludeId?: string | null) {
  const rows = await prisma.rental.findMany({
    where: {
      deviceId,
      deletedInGoogle: false,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      startsAt: { lte: new Date((to + 2) * 86_400_000) },
      endsAt: { gte: new Date((from - 2) * 86_400_000) },
    },
    select: { id: true, title: true, startsAt: true, endsAt: true, client: { select: { name: true, shortName: true } } },
  });
  return rows.map((r) => ({ r, span: spanOf(r.startsAt, r.endsAt) }));
}

export async function findConflicts(deviceId: string, startsAt: Date, endsAt: Date, excludeId?: string | null): Promise<Conflict[]> {
  const want = spanOf(startsAt, endsAt);
  const rows = await deviceSpans(deviceId, want.start, want.end, excludeId);
  return rows
    .filter((x) => overlaps(x.span, want))
    .map(({ r, span }) => ({ id: r.id, title: r.title, clientName: r.client?.shortName ?? r.client?.name ?? null, od: idxToYmd(span.start), do: idxToYmd(span.end) }));
}

// Kolizje + 2–3 najbliższe wolne początki tej samej długości (nie przed dziś).
export async function checkAvailability(deviceId: string, startsAt: Date, endsAt: Date, excludeId?: string | null, now = new Date()) {
  const want = spanOf(startsAt, endsAt);
  const rows = await deviceSpans(deviceId, want.start - 60, want.end + 60, excludeId);
  const conflicts = rows
    .filter((x) => overlaps(x.span, want))
    .map(({ r, span }) => ({ id: r.id, title: r.title, clientName: r.client?.shortName ?? r.client?.name ?? null, od: idxToYmd(span.start), do: idxToYmd(span.end) }));
  const busy: Span[] = rows.map((x) => x.span);
  const suggestions = conflicts.length ? nearestFreeStarts(busy, want, dayIdx(now), 3).map(idxToYmd) : [];
  return { free: conflicts.length === 0, conflicts, suggestions };
}

// Seria: dla każdego terminu — zajęty czy nie (i przez kogo).
export async function checkSpans(deviceId: string, spans: Span[], excludeId?: string | null) {
  if (!spans.length) return [];
  const from = Math.min(...spans.map((s) => s.start));
  const to = Math.max(...spans.map((s) => s.end));
  const rows = await deviceSpans(deviceId, from, to, excludeId);
  return spans.map((s) => {
    const hit = rows.find((x) => overlaps(x.span, s));
    return { od: idxToYmd(s.start), do: idxToYmd(s.end), busy: hit ? { id: hit.r.id, title: hit.r.title, clientName: hit.r.client?.shortName ?? hit.r.client?.name ?? null } : null };
  });
}

export function conflictMessage(c: Conflict[], deviceName: string): string {
  const dm = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
  const first = c[0];
  return `${deviceName} zajęte ${dm(first.od)}${first.do !== first.od ? `–${dm(first.do)}` : ""} – ${first.clientName ?? first.title}${c.length > 1 ? ` (+${c.length - 1})` : ""}.`;
}
