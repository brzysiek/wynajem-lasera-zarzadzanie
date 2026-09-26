import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { toLogValue } from "@/lib/changelog/diff";
import { parseProvenance } from "@/lib/changelog/provenance";
import { recordChanges } from "@/lib/changelog/record";
import { prisma } from "@/lib/prisma";
import { normalizePolishPhone } from "@/lib/reminders";
import { loadClientDetail } from "@/lib/clients/load";
import { parseContactInput } from "@/lib/clients/validate";
import { logInfo } from "@/lib/logger";

// Nowa osoba kontaktowa klienta. Pierwsza osoba zostaje główną; oznaczenie
// nowej jako głównej zdejmuje to oznaczenie z poprzedniej (dokładnie jedna
// główna na klienta). ADMIN/STAFF/AGENT; wpis w dzienniku zmian (AGENT:
// obowiązkowo źródło i pewność).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const provenance = parseProvenance(body ?? {}, { required: session.user.role === "AGENT" });
  if (!provenance.ok) return NextResponse.json({ message: provenance.message }, { status: 400 });
  const parsed = parseContactInput(body ?? {}, { normalizePhone: normalizePolishPhone }, { requireName: true });
  if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 });

  const client = await prisma.client.findUnique({ where: { id }, select: { _count: { select: { contacts: true } } } });
  if (!client) return NextResponse.json({ message: "Nie znaleziono klienta." }, { status: 404 });

  const isPrimary = client._count.contacts === 0 || parsed.data.isPrimary === true;
  await prisma.$transaction(async (tx) => {
    if (isPrimary) await tx.clientContact.updateMany({ where: { clientId: id }, data: { isPrimary: false } });
    const created = await tx.clientContact.create({ data: { ...parsed.data, clientId: id, isPrimary } });
    await recordChanges(tx, { userId: session.user.id, provenance: provenance.value }, [
      { entity: "CONTACT", entityId: created.id, clientId: id, operation: "CREATE", before: "null", after: toLogValue({ ...parsed.data, isPrimary }) },
    ]);
  });
  logInfo("client_contact_created", { userId: session.user.id, clientId: id });
  return NextResponse.json({ detail: await loadClientDetail(id) });
}
