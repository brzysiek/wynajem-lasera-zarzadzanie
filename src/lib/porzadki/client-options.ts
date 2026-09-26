import { prisma } from "@/lib/prisma";
import type { ReviewClient } from "@/lib/history/review-load";

// Lista klientów do wyboru w formularzach Porządków (wniosek, uwaga) — ten
// sam kształt co wybór klienta na /klienci/dopasowania (ClientPicker).
export async function loadClientOptions(): Promise<ReviewClient[]> {
  const clients = await prisma.client.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, city: true, contacts: { where: { isPrimary: true }, take: 1, select: { firstName: true, lastName: true } } },
  });
  return clients.map((c) => {
    const p = c.contacts[0];
    const person = p ? [p.firstName, p.lastName].filter(Boolean).join(" ") || null : null;
    return { id: c.id, name: c.name, city: c.city, person: person && person !== c.name ? person : null };
  });
}
