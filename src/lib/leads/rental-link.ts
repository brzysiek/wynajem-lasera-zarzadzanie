import { prisma } from "@/lib/prisma";
import { logError, logInfo } from "@/lib/logger";
import { normalizePolishPhone } from "@/lib/reminders";
import { FUNNEL_FROM, nextWorkdayAt10 } from "@/lib/leads/funnel";

// Lejek ↔ kalendarz (wniosek 18, decyzja 5): wynajem klienta z otwartym
// sygnałem → sygnał „Rezerwacja” z powiązanym wynajmem; wynajem zakończony →
// „Wygrana”; wynajem anulowany (usunięty z kalendarza) → z powrotem „Oferta
// wysłana” z krokiem „dopytać” na jutro; wygrana bez wynajmu → powiązanie
// z odbytym wynajmem klienta. Wołane po synchronizacji kalendarzy
// (cron), po zapisie rezerwacji w panelu i przy otwarciu Sygnałów.

const OPEN = ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA"] as const;
const digits = (p: string | null | undefined) => (p ? (normalizePolishPhone(p) ?? p).replace(/\D/g, "") : "");
const fmt = (d: Date) => d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });

export async function syncLeadsWithRentals(now = new Date()): Promise<{ linked: number; won: number; cancelled: number }> {
  let linked = 0;
  let won = 0;
  let cancelled = 0;

  // 1) Anulowane: wynajem usunięty z kalendarza.
  const gone = await prisma.lead.findMany({
    where: { archivedAt: null, stage: { in: ["REZERWACJA", "WYGRANA"] }, rental: { deletedInGoogle: true } },
    select: { id: true, clientId: true, stage: true, rental: { select: { startsAt: true, device: { select: { name: true } } } } },
  });
  for (const l of gone) {
    // Wygrana po odbytym wynajmie zostaje — cofamy tylko rezerwacje.
    if (l.stage === "WYGRANA") continue;
    await releaseLead(l.id, l.clientId, `Wynajem anulowany w kalendarzu (${l.rental?.device.name ?? ""} ${l.rental ? fmt(l.rental.startsAt) : ""}) — z powrotem „Oferta wysłana”, dopytać.`, now);
    cancelled++;
  }

  // 2) Wygrane: rezerwacja z wynajmem, który już się odbył.
  const done = await prisma.lead.findMany({
    where: { archivedAt: null, stage: "REZERWACJA", rental: { deletedInGoogle: false, endsAt: { lt: now } } },
    select: { id: true, clientId: true, rental: { select: { startsAt: true, device: { select: { name: true } } } } },
  });
  for (const l of done) {
    await prisma.$transaction([
      prisma.lead.update({ where: { id: l.id }, data: { stage: "WYGRANA", stageChangedAt: now, nextActionAt: null, nextStepType: null, nextStepNote: null } }),
      prisma.leadActivity.create({ data: { leadId: l.id, clientId: l.clientId, type: "STAGE_CHANGE", body: `Rezerwacja → Wygrana · wynajem zrealizowany (${l.rental!.device.name} ${fmt(l.rental!.startsAt)})` } }),
    ]);
    won++;
  }

  // 3) Nowe powiązania: otwarty sygnał z 2026 bez wynajmu + wynajem tego
  // klienta (albo z tym samym telefonem / e-mailem) utworzony po zapytaniu.
  const open = await prisma.lead.findMany({
    where: { archivedAt: null, stage: { in: [...OPEN] }, rentalId: null, createdAt: { gte: FUNNEL_FROM } },
    orderBy: { createdAt: "desc" },
    select: { id: true, clientId: true, stage: true, createdAt: true, contactPhone: true, contactEmail: true },
  });
  if (open.length) {
    const rentals = await prisma.rental.findMany({
      where: { deletedInGoogle: false, lead: null, createdAt: { gte: FUNNEL_FROM }, endsAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } },
      orderBy: { startsAt: "asc" },
      select: { id: true, clientId: true, createdAt: true, startsAt: true, contactPhoneCache: true, contactEmailCache: true, device: { select: { name: true } } },
    });
    const taken = new Set<string>();
    for (const l of open) {
      const phone = digits(l.contactPhone);
      const email = l.contactEmail?.toLowerCase() ?? null;
      const r = rentals.find(
        (x) =>
          !taken.has(x.id) &&
          x.createdAt >= l.createdAt &&
          ((l.clientId && x.clientId === l.clientId) || (!!phone && digits(x.contactPhoneCache) === phone) || (!!email && x.contactEmailCache?.toLowerCase() === email)),
      );
      if (!r) continue;
      taken.add(r.id);
      await prisma.$transaction([
        prisma.lead.update({
          where: { id: l.id },
          data: {
            rentalId: r.id,
            ...(l.stage !== "REZERWACJA" ? { stage: "REZERWACJA", stageChangedAt: now } : {}),
            nextActionAt: null,
            nextStepType: null,
            nextStepNote: "po wynajmie → Wygrana",
          },
        }),
        prisma.leadActivity.create({
          data: { leadId: l.id, clientId: l.clientId, type: "STAGE_CHANGE", body: `Rezerwacja w kalendarzu: ${r.device.name} ${fmt(r.startsAt)}${l.stage !== "REZERWACJA" ? " · etap: Rezerwacja" : ""}` },
        }),
      ]);
      linked++;
    }
  }
  // 4) Wygrane bez wynajmu (ustawione ręcznie przed lejkiem albo przez
  // import): powiązanie z odbytym wynajmem klienta po dacie zapytania. Etap
  // bez zmian — wygrana zaczyna się liczyć w raporcie.
  const wonLoose = await prisma.lead.findMany({
    where: { archivedAt: null, stage: "WYGRANA", rentalId: null, createdAt: { gte: FUNNEL_FROM } },
    orderBy: { createdAt: "asc" },
    select: { id: true, clientId: true, createdAt: true, contactPhone: true, contactEmail: true },
  });
  if (wonLoose.length) {
    const past = await prisma.rental.findMany({
      where: { deletedInGoogle: false, lead: null, startsAt: { gte: FUNNEL_FROM }, endsAt: { lt: now } },
      orderBy: { startsAt: "asc" },
      select: { id: true, clientId: true, startsAt: true, contactPhoneCache: true, contactEmailCache: true, device: { select: { name: true } } },
    });
    const taken = new Set<string>();
    for (const l of wonLoose) {
      const phone = digits(l.contactPhone);
      const email = l.contactEmail?.toLowerCase() ?? null;
      const r = past.find(
        (x) =>
          !taken.has(x.id) &&
          x.startsAt >= new Date(l.createdAt.getTime() - 86_400_000) &&
          ((l.clientId && x.clientId === l.clientId) || (!!phone && digits(x.contactPhoneCache) === phone) || (!!email && x.contactEmailCache?.toLowerCase() === email)),
      );
      if (!r) continue;
      taken.add(r.id);
      await prisma.$transaction([
        prisma.lead.update({ where: { id: l.id }, data: { rentalId: r.id } }),
        prisma.leadActivity.create({ data: { leadId: l.id, clientId: l.clientId, type: "STAGE_CHANGE", body: `Wygrana powiązana z wynajmem: ${r.device.name} ${fmt(r.startsAt)}` } }),
      ]);
      linked++;
    }
  }

  if (linked || won || cancelled) logInfo("leads_rentals_synced", { linked, won, cancelled });
  return { linked, won, cancelled };
}

async function releaseLead(leadId: string, clientId: string | null, body: string, now: Date) {
  await prisma.$transaction([
    prisma.lead.update({
      where: { id: leadId },
      data: { rentalId: null, stage: "OFERTA", stageChangedAt: now, nextActionAt: nextWorkdayAt10(now), nextStepType: "DOPYTAC", nextStepNote: "wynajem anulowany — dopytać" },
    }),
    prisma.leadActivity.create({ data: { leadId, clientId, type: "STAGE_CHANGE", body } }),
  ]);
}

// Usunięcie wynajmu w panelu (twarde): sygnał wraca do „Oferta wysłana”,
// zanim powiązanie zniknie razem z wynajmem.
export async function releaseLeadForDeletedRental(rentalId: string, now = new Date()): Promise<void> {
  const l = await prisma.lead.findUnique({ where: { rentalId }, select: { id: true, clientId: true, stage: true, rental: { select: { startsAt: true, device: { select: { name: true } } } } } });
  if (!l || l.stage !== "REZERWACJA") return;
  await releaseLead(l.id, l.clientId, `Wynajem usunięty (${l.rental?.device.name ?? ""} ${l.rental ? fmt(l.rental.startsAt) : ""}) — z powrotem „Oferta wysłana”, dopytać.`, now);
}

export async function syncLeadsWithRentalsSafe(): Promise<void> {
  try {
    await syncLeadsWithRentals();
  } catch (err) {
    logError("leads_rentals_sync_failed", err);
  }
}
