import { prisma } from "@/lib/prisma";
import { setEventTitle } from "@/lib/integrations/google-calendar";
import { recordChanges, type ChangeEntry } from "@/lib/changelog/record";
import { logError, logInfo } from "@/lib/logger";
import { bareTitle, clientTitleName, retitle, titleDiffers } from "./title-rules";

// Tytuł rezerwacji = nazwa robocza klienta (poprawka wniosku 29). Zmiana
// idzie do Google Calendar (z prefiksem godziny dostawy), do bazy i do
// dziennika. Tylko rezerwacje, które jeszcze się nie skończyły.

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export async function applyClientTitle(rentalIds: string[], actor: { userId: string }, source: string): Promise<{ renamed: number; failed: number }> {
  if (!rentalIds.length) return { renamed: 0, failed: 0 };
  const rows = await prisma.rental.findMany({
    where: { id: { in: rentalIds }, deletedInGoogle: false, endsAt: { gte: startOfToday() }, clientId: { not: null } },
    select: { id: true, title: true, deliveryTime: true, googleCalendarId: true, googleEventId: true, clientId: true, client: { select: { name: true, shortName: true } } },
  });
  let renamed = 0;
  let failed = 0;
  const entries: ChangeEntry[] = [];
  for (const r of rows) {
    if (!r.client) continue;
    const name = clientTitleName(r.client);
    if (!titleDiffers(r.title, name)) continue;
    const next = retitle(r.title, name, r.deliveryTime);
    try {
      await setEventTitle(r.googleCalendarId, r.googleEventId, next);
    } catch (err) {
      failed++;
      logError("rental_title_google_failed", err, { rentalId: r.id });
      continue;
    }
    await prisma.rental.update({ where: { id: r.id }, data: { title: next } });
    entries.push({ entity: "RENTAL", entityId: r.id, operation: "FIELD_CHANGE", clientId: r.clientId, field: "title", before: r.title, after: next });
    renamed++;
  }
  if (entries.length) await recordChanges(prisma, { userId: actor.userId, provenance: { source, confidence: "HIGH", batch: null } }, entries);
  if (renamed || failed) logInfo("rental_titles_applied", { renamed, failed, source });
  return { renamed, failed };
}

export async function applyClientTitleSafe(rentalIds: string[], actor: { userId: string }, source: string) {
  try {
    return await applyClientTitle(rentalIds, actor, source);
  } catch (err) {
    logError("rental_title_apply_failed", err, { count: rentalIds.length });
    return { renamed: 0, failed: rentalIds.length };
  }
}

// Zmiana nazwy / nazwy roboczej klienta: przyszłe rezerwacje, których tytuł
// był równy starej nazwie, dostają nową. Inne tytuły zostają bez zmian.
export async function retitleAfterClientRename(clientId: string, oldNames: string[], actor: { userId: string }) {
  const olds = oldNames.map((n) => n.trim()).filter(Boolean);
  if (!olds.length) return { renamed: 0, failed: 0 };
  const rows = await prisma.rental.findMany({ where: { clientId, deletedInGoogle: false, endsAt: { gte: startOfToday() } }, select: { id: true, title: true } });
  const ids = rows.filter((r) => olds.some((o) => !titleDiffers(r.title, o))).map((r) => r.id);
  return applyClientTitleSafe(ids, actor, "zmiana nazwy roboczej klienta — tytuły przyszłych rezerwacji");
}

// Jednorazowy przegląd: przyszłe rezerwacje z klientem, których tytuł ≠ nazwa robocza.
export async function loadTitleMismatches() {
  const rows = await prisma.rental.findMany({
    where: { deletedInGoogle: false, endsAt: { gte: startOfToday() }, clientId: { not: null } },
    orderBy: { startsAt: "asc" },
    select: { id: true, title: true, startsAt: true, deliveryTime: true, device: { select: { name: true } }, client: { select: { name: true, shortName: true } } },
  });
  return rows
    .filter((r) => r.client && titleDiffers(r.title, clientTitleName(r.client)))
    .map((r) => ({ rentalId: r.id, startsAt: r.startsAt.toISOString(), device: r.device.name, title: r.title, newTitle: retitle(r.title, clientTitleName(r.client!), r.deliveryTime), bare: bareTitle(r.title), hasShortName: !!r.client!.shortName?.trim() }));
}
