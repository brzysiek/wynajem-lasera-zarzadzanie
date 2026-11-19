import { prisma } from "@/lib/prisma";
import { defaultLeadOwnerId } from "@/lib/leads/owner";
import { DORMANT_REASON_LABEL, type DormantReasonKey } from "@/lib/clients/labels";

// Wniosek 57: ręczne „Uśpiona”. Z datą powrotu panel od razu zakłada zadanie na ten dzień
// („zapytać o powrót”, przy kliencie, dla Ani) — tak samo jak „Zrezygnował” z ponownym
// kontaktem (resign.ts), więc w dniu powrotu sprawa sama się pojawia na liście zadań.
// Samo oznaczenie wygasa przy nowej rezerwacji / nowym wynajmie / po dacie powrotu
// (status.ts — liczone przy odczycie).
export async function createDormantReturnTask(clientId: string, returnAt: Date, reason: DormantReasonKey | null, actorUserId: string | null): Promise<string | null> {
  const c = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true, shortName: true } });
  if (!c) return null;
  const name = c.shortName ?? c.name;
  const due = new Date(returnAt.getUTCFullYear(), returnAt.getUTCMonth(), returnAt.getUTCDate(), 9, 0, 0);
  const task = await prisma.task.create({
    data: {
      title: `Zapytać o powrót — ${name}`.slice(0, 191),
      notes: `Klientka oznaczona jako uśpiona${reason ? ` (${DORMANT_REASON_LABEL[reason]})` : ""}. Minęła data powrotu — zapytaj, czy planuje wynajem.`,
      dueDate: due,
      assigneeId: await defaultLeadOwnerId(),
      authorId: actorUserId || null,
      clientId,
      links: { create: { kind: "CLIENT", refId: clientId } },
    },
  });
  return task.id;
}
