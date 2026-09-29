import { prisma } from "@/lib/prisma";
import { recordChanges } from "@/lib/changelog/record";
import { toLogValue } from "@/lib/changelog/diff";
import { defaultLeadOwnerId } from "@/lib/leads/owner";
import { RESIGN_REASON_LABEL, type ResignReasonKey } from "@/lib/clients/labels";

// Wniosek 24: stan klienta „Zrezygnował” (to nie „Nie kontaktować”).
// Ustawiany na karcie klienta albo wynikiem rozmowy „Rezygnuje”. Z datą
// ponownego kontaktu panel od razu zakłada zadanie na ten dzień (przy
// kliencie), więc w dniu powrotu sprawa sama się pojawia. Znika sam przy
// nowej rezerwacji (clearResignedForRentals).

export type ResignInput = { reason: ResignReasonKey; note?: string | null; at?: Date; recontactAt?: Date | null };

export async function setResigned(clientId: string, input: ResignInput, actor: { userId: string; source?: string }): Promise<void> {
  const c = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, resignedReason: true } });
  if (!c) throw new Error("Klient nie istnieje.");
  const at = input.at ?? new Date();
  await prisma.$transaction(async (tx) => {
    await tx.client.update({
      where: { id: clientId },
      data: { resignedAt: at, resignedReason: input.reason, resignedNote: input.note?.trim() || null, resignedRecontactAt: input.recontactAt ?? null },
    });
    await recordChanges(tx, { userId: actor.userId, provenance: actor.source ? { source: actor.source, confidence: "HIGH", batch: null } : null }, [
      { entity: "CLIENT", entityId: clientId, clientId, operation: "STATUS_CHANGE", field: "resigned", before: toLogValue(c.resignedReason), after: toLogValue(input.reason) },
    ]);
    if (input.recontactAt) {
      await tx.task.create({
        data: {
          title: `Ponowny kontakt po rezygnacji — ${c.name}`.slice(0, 191),
          notes: `Zrezygnowała (${RESIGN_REASON_LABEL[input.reason]}) ${at.toLocaleDateString("pl-PL")}${input.note ? `: ${input.note}` : ""}. Zadzwoń przed sezonem.`,
          dueDate: input.recontactAt,
          assigneeId: await defaultLeadOwnerId(),
          authorId: actor.userId || null,
          clientId,
          links: { create: { kind: "CLIENT", refId: clientId } },
        },
      });
    }
  });
}

export async function clearResigned(clientId: string, actor: { userId: string; source: string }): Promise<void> {
  const c = await prisma.client.findUnique({ where: { id: clientId }, select: { resignedReason: true } });
  if (!c?.resignedReason) return;
  await prisma.$transaction(async (tx) => {
    await tx.client.update({ where: { id: clientId }, data: { resignedAt: null, resignedReason: null, resignedNote: null, resignedRecontactAt: null } });
    await recordChanges(tx, { userId: actor.userId, provenance: { source: actor.source, confidence: "HIGH", batch: null } }, [
      { entity: "CLIENT", entityId: clientId, clientId, operation: "STATUS_CHANGE", field: "resigned", before: toLogValue(c.resignedReason), after: "null" },
    ]);
  });
}

// Nowa rezerwacja (wpisana po rezygnacji) zdejmuje stan „Zrezygnował”.
export async function clearResignedForRentals(rentalIds: string[], userId = ""): Promise<number> {
  if (!rentalIds.length) return 0;
  const rows = await prisma.rental.findMany({
    where: { id: { in: rentalIds }, deletedInGoogle: false, eventType: "WYNAJEM", client: { resignedAt: { not: null } } },
    select: { createdAt: true, clientId: true, client: { select: { resignedAt: true } } },
  });
  let cleared = 0;
  for (const r of rows) {
    if (!r.clientId || !r.client?.resignedAt || r.createdAt < r.client.resignedAt) continue;
    await clearResigned(r.clientId, { userId, source: "automatycznie: nowa rezerwacja po rezygnacji" });
    cleared++;
  }
  return cleared;
}
