import { prisma } from "@/lib/prisma";
import { CATEGORY_TO_INTEREST, DEVICE_INTEREST_KEYS, type DeviceInterestKey } from "@/lib/clients/labels";
import { freeDatesFor } from "@/lib/leads/offer-draft";
import type { DevicePricingCategory } from "@prisma/client";

// Sygnały → Na dziś (wniosek 27): wolne terminy każdego urządzenia (karta
// sprawy) i zadania przy sygnałach (sekcja + kafel „Zadania przy sygnałach”).

const short = (d: Date) => d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });

export async function loadFreeByInterest(now = new Date()): Promise<Partial<Record<DeviceInterestKey, string[]>>> {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const out: Partial<Record<DeviceInterestKey, string[]>> = {};
  for (const key of DEVICE_INTEREST_KEYS) {
    if (key === "SZKOLENIE") continue;
    const cats = Object.entries(CATEGORY_TO_INTEREST).filter(([, v]) => v === key).map(([k]) => k) as DevicePricingCategory[];
    if (!cats.length) continue;
    const { devices, dates } = await freeDatesFor(cats, tomorrow, 1);
    if (devices.length) out[key] = dates.map(short);
  }
  return out;
}

export type SignalTask = { id: string; title: string; dueDate: string | null; assigneeId: string | null; assignee: string | null; author: string | null; leadId: string; leadTitle: string; clientName: string | null };

// Otwarte zadania przy sygnałach z terminem do dziś (także zaległe).
export async function loadSignalTasks(now = new Date()): Promise<SignalTask[]> {
  const eod = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const rows = await prisma.task.findMany({
    where: { status: "OPEN", dueDate: { lt: eod }, OR: [{ leadId: { not: null } }, { links: { some: { kind: "LEAD" } } }] },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      dueDate: true,
      assigneeId: true,
      assignee: { select: { name: true } },
      author: { select: { name: true } },
      leadId: true,
      links: { where: { kind: "LEAD" }, take: 1, select: { refId: true } },
    },
  });
  const leadIds = [...new Set(rows.map((t) => t.leadId ?? t.links[0]?.refId).filter((x): x is string => !!x))];
  const leads = await prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, title: true, client: { select: { name: true, shortName: true } } } });
  return rows.flatMap((t) => {
    const lid = t.leadId ?? t.links[0]?.refId;
    const l = leads.find((x) => x.id === lid);
    if (!l) return [];
    return [{ id: t.id, title: t.title, dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null, assigneeId: t.assigneeId, assignee: t.assignee?.name ?? null, author: t.author?.name ?? null, leadId: l.id, leadTitle: l.title, clientName: l.client?.shortName ?? l.client?.name ?? null }];
  });
}
