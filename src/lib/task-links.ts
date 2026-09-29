import { prisma } from "@/lib/prisma";
import { linkHref, linksFromArrays, rentalChipLabel, rentalIssues, type TaskLinkDto, type TaskLinkInput, type TaskLinkKind } from "@/lib/task-link-rules";

// Powiązania zadań (wniosek 22): tabela task_links + dotychczasowe pola
// tasks.clientId / leadId (zgodność). Chip wynajmu z brakami liczonymi na
// bieżąco — po poprawieniu danych chip sam dostaje ✓.

const num = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));

export async function resolveTaskLinks(tasks: { id: string; clientId: string | null; leadId: string | null }[]): Promise<Map<string, TaskLinkDto[]>> {
  const out = new Map<string, TaskLinkDto[]>();
  if (!tasks.length) return out;
  const rows = await prisma.taskLink.findMany({ where: { taskId: { in: tasks.map((t) => t.id) } }, orderBy: { createdAt: "asc" } });
  const pairs = new Map<string, TaskLinkInput[]>();
  for (const t of tasks) {
    const list: TaskLinkInput[] = rows.filter((r) => r.taskId === t.id).map((r) => ({ kind: r.kind as TaskLinkKind, refId: r.refId }));
    if (t.clientId && !list.some((l) => l.kind === "CLIENT" && l.refId === t.clientId)) list.push({ kind: "CLIENT", refId: t.clientId });
    if (t.leadId && !list.some((l) => l.kind === "LEAD" && l.refId === t.leadId)) list.push({ kind: "LEAD", refId: t.leadId });
    pairs.set(t.id, list);
  }
  const ids = (k: TaskLinkKind) => [...new Set([...pairs.values()].flat().filter((l) => l.kind === k).map((l) => l.refId))];
  const [rentals, clients, leads, invoices] = await Promise.all([
    prisma.rental.findMany({
      where: { id: { in: ids("RENTAL") } },
      select: {
        id: true,
        startsAt: true,
        eventType: true,
        clientId: true,
        deletedInGoogle: true,
        client: { select: { name: true, shortName: true } },
        device: { select: { name: true, variantOptions: true } },
        finance: {
          select: {
            deviceVariant: true,
            totalNet: true,
            baseRentalPriceNet: true,
            pulseSurchargeNet: true,
            transportPriceNet: true,
            transportPaidSeparately: true,
            capUsedHS: true,
            capCountHS: true,
            capFeeNet: true,
            membraneUsed: true,
            membraneCount: true,
            membraneFeeNet: true,
          },
        },
      },
    }),
    prisma.client.findMany({ where: { id: { in: ids("CLIENT") } }, select: { id: true, name: true, shortName: true } }),
    prisma.lead.findMany({ where: { id: { in: ids("LEAD") } }, select: { id: true, title: true } }),
    prisma.clientInvoice.findMany({ where: { id: { in: ids("INVOICE") } }, select: { id: true, number: true, clientId: true, buyerName: true } }),
  ]);
  for (const [taskId, list] of pairs) {
    const dtos: TaskLinkDto[] = [];
    for (const l of list) {
      if (l.kind === "RENTAL") {
        const r = rentals.find((x) => x.id === l.refId);
        if (!r) continue;
        const variants = Array.isArray(r.device.variantOptions) ? (r.device.variantOptions as unknown[]).filter((x): x is string => typeof x === "string") : [];
        const f = r.finance;
        dtos.push({
          kind: "RENTAL",
          refId: r.id,
          label: `${rentalChipLabel(r.device.name, r.startsAt, r.client?.shortName ?? r.client?.name ?? null)}${r.deletedInGoogle ? " (usunięty)" : ""}`,
          href: linkHref("RENTAL", r.id),
          issues: rentalIssues({
            eventType: r.eventType,
            clientId: r.clientId,
            variantOptions: variants,
            finance: f
              ? {
                  deviceVariant: f.deviceVariant,
                  totalNet: num(f.totalNet) ?? 0,
                  baseNet: num(f.baseRentalPriceNet) ?? 0,
                  pulseNet: num(f.pulseSurchargeNet),
                  transportNet: num(f.transportPriceNet),
                  transportSeparate: f.transportPaidSeparately,
                  capUsed: f.capUsedHS,
                  capCount: f.capCountHS,
                  capFee: num(f.capFeeNet),
                  membraneUsed: f.membraneUsed,
                  membraneCount: f.membraneCount,
                  membraneFee: num(f.membraneFeeNet),
                }
              : null,
          }),
        });
      } else if (l.kind === "CLIENT") {
        const c = clients.find((x) => x.id === l.refId);
        if (c) dtos.push({ kind: "CLIENT", refId: c.id, label: c.shortName ?? c.name, href: linkHref("CLIENT", c.id), issues: null });
      } else if (l.kind === "LEAD") {
        const x = leads.find((y) => y.id === l.refId);
        if (x) dtos.push({ kind: "LEAD", refId: x.id, label: x.title, href: linkHref("LEAD", x.id), issues: null });
      } else {
        const i = invoices.find((y) => y.id === l.refId);
        if (i) dtos.push({ kind: "INVOICE", refId: i.id, label: `FV ${i.number}`, href: linkHref("INVOICE", i.id, i.clientId), issues: null });
      }
    }
    out.set(taskId, dtos);
  }
  return out;
}

// Sprawdza, czy wskazane rekordy istnieją — zwraca opis braków (albo null).
export async function missingLinks(links: TaskLinkInput[]): Promise<string | null> {
  const of = (k: TaskLinkKind) => links.filter((l) => l.kind === k).map((l) => l.refId);
  const [r, c, l, i] = await Promise.all([
    prisma.rental.count({ where: { id: { in: of("RENTAL") } } }),
    prisma.client.count({ where: { id: { in: of("CLIENT") } } }),
    prisma.lead.count({ where: { id: { in: of("LEAD") } } }),
    prisma.clientInvoice.count({ where: { id: { in: of("INVOICE") } } }),
  ]);
  const bad = [
    r < of("RENTAL").length ? "wynajem" : null,
    c < of("CLIENT").length ? "klient" : null,
    l < of("LEAD").length ? "sygnał" : null,
    i < of("INVOICE").length ? "faktura" : null,
  ].filter(Boolean);
  return bad.length ? `Nie znaleziono: ${bad.join(", ")} (sprawdź ID powiązań).` : null;
}

// Zastępuje powiązania zadania podaną listą.
export async function setTaskLinks(taskId: string, links: TaskLinkInput[]): Promise<void> {
  await prisma.$transaction([
    prisma.taskLink.deleteMany({ where: { taskId } }),
    ...(links.length ? [prisma.taskLink.createMany({ data: links.map((l) => ({ taskId, kind: l.kind, refId: l.refId })), skipDuplicates: true })] : []),
  ]);
}

export type OpenTaskDto = { id: string; title: string; dueDate: string | null; assignee: string | null };

// „Otwarte zadania” na karcie rezerwacji / klienta / sygnału.
export async function loadOpenTasksFor(kind: TaskLinkKind, refId: string): Promise<OpenTaskDto[]> {
  const legacy = kind === "CLIENT" ? [{ clientId: refId }] : kind === "LEAD" ? [{ leadId: refId }] : [];
  const rows = await prisma.task.findMany({
    where: { status: "OPEN", OR: [{ links: { some: { kind, refId } } }, ...legacy] },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    take: 20,
    select: { id: true, title: true, dueDate: true, assignee: { select: { name: true } } },
  });
  return rows.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null, assignee: t.assignee?.name ?? null }));
}

// Dokleja powiązania do DTO zadań (lista, zapis).
export async function withLinks<T extends { id: string; clientId: string | null; leadId: string | null; links: TaskLinkDto[] }>(tasks: T[]): Promise<T[]> {
  const map = await resolveTaskLinks(tasks);
  return tasks.map((t) => ({ ...t, links: map.get(t.id) ?? [] }));
}

// Powiązania z body API / MCP: {wynajmy, klienci, sygnaly, faktury}. null =
// bez zmian; błąd formatu albo nieistniejący rekord → komunikat.
export async function parseLinksBody(body: Record<string, unknown> | null): Promise<{ links: TaskLinkInput[] | null; error: string | null }> {
  let links: TaskLinkInput[] | null;
  try {
    links = linksFromArrays(body ?? {});
  } catch (err) {
    return { links: null, error: err instanceof Error ? err.message : String(err) };
  }
  if (!links) return { links: null, error: null };
  return { links, error: await missingLinks(links) };
}
