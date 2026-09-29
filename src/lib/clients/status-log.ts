import { prisma } from "@/lib/prisma";
import { loadClientStatusInfo } from "@/lib/clients/load";
import { logInfo } from "@/lib/logger";

// Wniosek 20: status jest liczony przy odczycie, więc jego automatyczne
// zmiany (upływ czasu, nowa rezerwacja, anulowanie, nowa faktura) zapisujemy
// do dziennika codziennie — porównanie z ostatnim policzonym statusem
// (Client.lastStatus). Pierwsze przeliczenie tylko zapamiętuje status.
export async function recordStatusChanges(now = new Date()): Promise<{ checked: number; changed: number }> {
  const clients = await prisma.client.findMany({ where: { archivedAt: null }, select: { id: true, name: true, lastStatus: true } });
  const info = await loadClientStatusInfo(
    clients.map((c) => c.id),
    now,
  );
  let changed = 0;
  for (const c of clients) {
    const status = info.get(c.id)?.status;
    if (!status || status === c.lastStatus) continue;
    await prisma.$transaction([
      ...(c.lastStatus
        ? [
            prisma.changeLog.create({
              data: {
                clientId: c.id,
                clientName: c.name,
                entity: "CLIENT",
                entityId: c.id,
                operation: "STATUS_CHANGE",
                field: "status",
                before: JSON.stringify(c.lastStatus),
                after: JSON.stringify(status),
                source: "automatycznie: status z przyjazdów i rezerwacji (wniosek 20)",
              },
            }),
          ]
        : []),
      prisma.client.update({ where: { id: c.id }, data: { lastStatus: status } }),
    ]);
    if (c.lastStatus) changed++;
  }
  if (changed) logInfo("client_status_changes", { changed });
  return { checked: clients.length, changed };
}
