import { prisma } from "@/lib/prisma";
import { warsawDay } from "@/lib/marketing/period";
import { TCH, classifyChannel, type ParsedBeacon } from "./ingest";

// Wniosek 54, etap 2: zapis paczek licznika. Surowe zdarzenia 13 miesięcy, sumy dzienne bez
// limitu. Nic, co identyfikuje osobę (patrz ingest.ts) — tu trafia tylko to, co przeszło walidację.

export const RETENTION_MONTHS = 13;

export async function storeBeacon(b: ParsedBeacon, now = new Date()): Promise<number> {
  // Kanał wyświetlenia: z „wejscie” w tej paczce, w przeciwnym razie z wcześniejszej paczki (ten sam pv).
  const entry = b.events.find((e) => e.type === "wejscie");
  let info = entry ? classifyChannel(entry.data as Parameters<typeof classifyChannel>[0]) : null;
  if (!info) {
    const prev = await prisma.trafficEvent.findFirst({ where: { pv: b.pv, type: "wejscie" }, select: { channel: true } });
    info = { channel: prev?.channel ?? TCH.UNKNOWN, campaignKey: null, campaign: null, term: null, group: null };
  }
  const channel = info.channel.slice(0, 40);
  const rows = b.events.map((e) => ({
    at: now,
    pv: b.pv,
    path: b.path,
    dev: b.dev,
    type: e.type,
    channel,
    data: (e.type === "wejscie" ? { ...e.data, channel, campaignKey: info!.campaignKey, campaign: info!.campaign, term: info!.term, group: info!.group } : e.data) as object,
  }));
  await prisma.trafficEvent.createMany({ data: rows });

  const day = warsawDay(now);
  const counts = new Map<string, number>();
  for (const e of b.events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  for (const [type, n] of counts) {
    await prisma.$executeRaw`INSERT INTO traffic_daily (day, path, channel, dev, type, count) VALUES (${day}, ${b.path}, ${channel}, ${b.dev}, ${type}, ${n}) ON DUPLICATE KEY UPDATE count = count + VALUES(count)`;
  }
  return rows.length;
}

// Zadanie czyszczące (codzienny cron): surowe zdarzenia starsze niż 13 miesięcy; sumy dzienne zostają.
export async function purgeOldTraffic(now = new Date()): Promise<number> {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  const res = await prisma.trafficEvent.deleteMany({ where: { at: { lt: cutoff } } });
  return res.count;
}
