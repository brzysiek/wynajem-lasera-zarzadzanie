import { prisma } from "@/lib/prisma";
import { addDays, warsawDay } from "@/lib/marketing/period";
import { metricsDto, reclassify, type TrafficMetricsDto } from "./ads";
import { dropTestEvents } from "./ingest";
import { buildTrafficReport, trafficJoin, type TrafficFilter, type TrafficJoin, type TrafficReport, type TrafficRow } from "./report";

// Wniosek 54, etap 2: wczytanie zdarzeń licznika ruchu z okresu (dni Europe/Warsaw).
const MAX_ROWS = 300_000;

export async function loadTrafficRows(from: string, to: string): Promise<TrafficRow[]> {
  const rows = await prisma.trafficEvent.findMany({
    where: { at: { gte: new Date(`${addDays(from, -1)}T00:00:00Z`), lte: new Date(`${addDays(to, 2)}T00:00:00Z`) } },
    select: { at: true, pv: true, path: true, dev: true, type: true, channel: true, data: true },
    orderBy: { id: "asc" },
    take: MAX_ROWS,
  });
  const mapped = rows
    .filter((r) => {
      const day = warsawDay(r.at);
      return day >= from && day <= to;
    })
    .map((r) => ({ at: r.at, pv: r.pv, path: r.path, dev: r.dev, type: r.type, channel: r.channel, data: r.data && typeof r.data === "object" && !Array.isArray(r.data) ? (r.data as Record<string, unknown>) : null }));
  // Kanał i klucze zawsze wg aktualnych reguł z surowych pól „wejscie”.
  return reclassify(dropTestEvents(mapped));
}

export async function loadTrafficReport(from: string, to: string, f: TrafficFilter = {}): Promise<{ report: TrafficReport; join: TrafficJoin }> {
  const rows = await loadTrafficRows(from, to);
  return { report: buildTrafficReport(rows, { from, to }, f), join: trafficJoin(rows) };
}

// Serializowalna postać łączenia (do komponentów klienckich).
export type TrafficJoinDto = { byChannel: Record<string, { visits: number; formStarts: number }>; byCampaign: Record<string, { visits: number; formStarts: number }>; byKeyword: Record<string, { visits: number; formStarts: number }>; hasData: boolean };
export function joinDto(j: TrafficJoin): TrafficJoinDto {
  return { byChannel: Object.fromEntries(j.byChannel), byCampaign: Object.fromEntries(j.byCampaign), byKeyword: Object.fromEntries(j.byKeyword), hasData: j.byChannel.size > 0 };
}

export async function loadTrafficJoin(from: string, to: string): Promise<TrafficJoinDto> {
  return joinDto(trafficJoin(await loadTrafficRows(from, to)));
}

// Metryki jakości ruchu z reklam (wg kanału / kampanii / grupy / frazy) do kolumn w Kampaniach i Słowach kluczowych.
export async function loadTrafficMetrics(from: string, to: string): Promise<TrafficMetricsDto> {
  return metricsDto(await loadTrafficRows(from, to));
}
