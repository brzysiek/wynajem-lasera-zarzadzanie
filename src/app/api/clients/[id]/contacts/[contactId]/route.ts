import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireStaffSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { changedFields } from "@/lib/changelog/diff";
import { parseProvenance } from "@/lib/changelog/provenance";
import { fieldEntries, recordChanges } from "@/lib/changelog/record";
import { prisma } from "@/lib/prisma";
import { normalizePolishPhone } from "@/lib/reminders";
import { loadClientDetail } from "@/lib/clients/load";
import { parseContactInput } from "@/lib/clients/validate";
import { CONTACT_CACHE_KEYS, refreshFutureRentalCaches } from "@/lib/clients/refresh";
import { logInfo } from "@/lib/logger";

async function findContact(clientId: string, contactId: string) {
  return prisma.clientContact.findFirst({ where: { id: contactId, clientId } });
}

// Zmiana osoby kontaktowej — ADMIN/STAFF/AGENT, każda zmiana pola w
// dzienniku zmian. AGENT: obowiązkowo źródło i pewność zmiany.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; contactId: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id, contactId } = await params;
  const contact = await findContact(id, contactId);
  if (!contact) return NextResponse.json({ message: "Nie znaleziono osoby." }, { status: 404 });

  const body = await req.json().catch(() => null);
  const provenance = parseProvenance(body ?? {}, { required: session.user.role === "AGENT" });
  if (!provenance.ok) return NextResponse.json({ message: provenance.message }, { status: 400 });
  const parsed = parseContactInput(body ?? {}, { normalizePhone: normalizePolishPhone });
  if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 });
  // Zdjęcie oznaczenia głównej osoby tylko przez wskazanie innej jako głównej.
  const { isPrimary, ...data } = parsed.data;
  const changes = changedFields(contact as unknown as Record<string, unknown>, { ...data, ...(isPrimary ? { isPrimary: true } : {}) });

  await prisma.$transaction(async (tx) => {
    if (isPrimary) await tx.clientContact.updateMany({ where: { clientId: id }, data: { isPrimary: false } });
    await tx.clientContact.update({ where: { id: contactId }, data: { ...data, ...(isPrimary ? { isPrimary: true } : {}) } });
    await recordChanges(tx, { userId: session.user.id, provenance: provenance.value }, fieldEntries("CONTACT", contactId, id, changes));
  });

  const touchesRentals = CONTACT_CACHE_KEYS.some((k) => k in data);
  const refreshedRentals = touchesRentals ? await refreshFutureRentalCaches({ clientId: id, contactId }) : 0;
  logInfo("client_contact_updated", { userId: session.user.id, clientId: id, contactId, fields: Object.keys(parsed.data), refreshedRentals });
  return NextResponse.json({ detail: await loadClientDetail(id), refreshedRentals });
}

// Usunięcie osoby: nie wolno usunąć OSTATNIEJ osoby, jeśli ma powiązane
// wynajmy (spec 3.3 — najpierw przepnij). Wynajmy usuwanej osoby (nie
// ostatniej) przechodzą na osobę główną klienta. W HubSpocie nic się nie
// dzieje (panel nigdy niczego tam nie usuwa). Tylko ADMIN/STAFF — AGENT
// niczego nie usuwa.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; contactId: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id, contactId } = await params;
  const contact = await findContact(id, contactId);
  if (!contact) return NextResponse.json({ message: "Nie znaleziono osoby." }, { status: 404 });

  const [others, rentals] = await Promise.all([
    prisma.clientContact.findMany({ where: { clientId: id, id: { not: contactId } }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }),
    prisma.rental.count({ where: { clientContactId: contactId } }),
  ]);
  if (others.length === 0 && rentals > 0) {
    return NextResponse.json(
      { message: "To jedyna osoba klienta i ma powiązane wynajmy — najpierw dodaj inną osobę." },
      { status: 409 },
    );
  }

  await prisma.$transaction(async (tx) => {
    const heir = others[0];
    if (heir) {
      await tx.rental.updateMany({ where: { clientContactId: contactId }, data: { clientContactId: heir.id } });
      if (contact.isPrimary) await tx.clientContact.update({ where: { id: heir.id }, data: { isPrimary: true } });
    }
    await tx.clientContact.delete({ where: { id: contactId } });
  });
  // Przyszłe wynajmy przejęte przez osobę główną — dane kontaktu na nich
  // przestawiamy na nią (przeszłe zostają, jak w całym module).
  if (rentals > 0 && others[0]) await refreshFutureRentalCaches({ clientId: id, contactId: others[0].id });
  logInfo("client_contact_deleted", { userId: session.user.id, clientId: id, contactId, movedRentals: rentals });
  return NextResponse.json({ detail: await loadClientDetail(id) });
}
