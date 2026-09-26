import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireStaffSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { loadClientDetail } from "@/lib/clients/load";
import { refreshFutureRentalCaches } from "@/lib/clients/refresh";
import { patchContact } from "@/lib/clients/update";
import { logInfo } from "@/lib/logger";

async function findContact(clientId: string, contactId: string) {
  return prisma.clientContact.findFirst({ where: { id: contactId, clientId } });
}

// Zmiana osoby kontaktowej — ADMIN/STAFF/AGENT; logika (dziennik zmian,
// źródło zmiany dla AGENT) w src/lib/clients/update.ts.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; contactId: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id, contactId } = await params;
  const body = await req.json().catch(() => null);
  const result = await patchContact(id, contactId, body ?? {}, { userId: session.user.id, role: session.user.role });
  if (!result.ok) return NextResponse.json({ message: result.message }, { status: result.status });
  logInfo("client_contact_updated", { userId: session.user.id, clientId: id, contactId, fields: Object.keys(body ?? {}), refreshedRentals: result.refreshedRentals });
  return NextResponse.json({ detail: await loadClientDetail(id), refreshedRentals: result.refreshedRentals });
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
