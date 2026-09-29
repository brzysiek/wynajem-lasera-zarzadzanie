import { prisma } from "@/lib/prisma";
import { normalizePolishPhone } from "@/lib/reminders";
import { recordChanges } from "@/lib/changelog/record";
import { toLogValue } from "@/lib/changelog/diff";
import { findClientDuplicates, type ClientHit } from "@/lib/clients/search";
import { emailKey, splitPersonName } from "@/lib/clients/search-rules";

// „+ Nowy klient” bez wychodzenia z formularza rezerwacji (wniosek 23):
// imię i nazwisko albo nazwa gabinetu + telefon albo e-mail (jedno z dwóch),
// opcjonalnie miejscowość. Przed zapisem kontrola duplikatów (telefon,
// e-mail) — „Czy to ta klientka?”; force = zapisz mimo to. Nowy klient od
// razu na liście klientów (Potencjalny), status po rezerwacji wg wniosku 20.

export type QuickClientInput = { name: string; phone?: string | null; email?: string | null; city?: string | null; source?: string | null; force?: boolean };
export type QuickClientResult = { ok: true; id: string } | { ok: false; message: string; duplicates?: ClientHit[] };

export async function quickCreateClient(input: QuickClientInput, actor: { userId: string; source?: string }): Promise<QuickClientResult> {
  const name = (input.name ?? "").trim().slice(0, 191);
  if (!name) return { ok: false, message: "Wpisz imię i nazwisko albo nazwę gabinetu." };
  const phoneRaw = (input.phone ?? "").trim();
  const phone = phoneRaw ? normalizePolishPhone(phoneRaw) : null;
  if (phoneRaw && !phone) return { ok: false, message: "Nieprawidłowy numer telefonu." };
  const emailRaw = (input.email ?? "").trim();
  const email = emailRaw ? emailKey(emailRaw) : null;
  if (emailRaw && !email) return { ok: false, message: "Nieprawidłowy e-mail." };
  if (!phone && !email) return { ok: false, message: "Podaj telefon albo e-mail (jedno z dwóch)." };
  if (!input.force) {
    const duplicates = await findClientDuplicates({ phone, email });
    if (duplicates.length) return { ok: false, message: "Czy to ta klientka? Ten telefon albo e-mail jest już w panelu.", duplicates };
  }
  const person = splitPersonName(name);
  const city = (input.city ?? "").trim().slice(0, 191) || null;
  const created = await prisma.client.create({
    data: {
      name,
      city,
      qualifiedAt: new Date(),
      qualifiedReason: "MANUAL",
      contacts: { create: { firstName: person.firstName, lastName: person.lastName, phone, email, isPrimary: true } },
    },
    select: { id: true },
  });
  await recordChanges(prisma, { userId: actor.userId, provenance: actor.source ? { source: actor.source, confidence: "HIGH", batch: null } : null }, [
    { entity: "CLIENT", entityId: created.id, clientId: created.id, operation: "CREATE", before: "null", after: toLogValue({ name, phone, email, city }) },
  ]);
  return { ok: true, id: created.id };
}
