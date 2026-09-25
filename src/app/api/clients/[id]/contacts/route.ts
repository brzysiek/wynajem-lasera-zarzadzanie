import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { normalizePolishPhone } from "@/lib/reminders";
import { loadClientDetail } from "@/lib/clients/load";
import { parseContactInput } from "@/lib/clients/validate";
import { logInfo } from "@/lib/logger";

// Nowa osoba kontaktowa klienta. Pierwsza osoba zostaje główną; oznaczenie
// nowej jako głównej zdejmuje to oznaczenie z poprzedniej (dokładnie jedna
// główna na klienta).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = parseContactInput(body ?? {}, { normalizePhone: normalizePolishPhone }, { requireName: true });
  if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 });

  const client = await prisma.client.findUnique({ where: { id }, select: { _count: { select: { contacts: true } } } });
  if (!client) return NextResponse.json({ message: "Nie znaleziono klienta." }, { status: 404 });

  const isPrimary = client._count.contacts === 0 || parsed.data.isPrimary === true;
  await prisma.$transaction(async (tx) => {
    if (isPrimary) await tx.clientContact.updateMany({ where: { clientId: id }, data: { isPrimary: false } });
    await tx.clientContact.create({ data: { ...parsed.data, clientId: id, isPrimary } });
  });
  logInfo("client_contact_created", { userId: session.user.id, clientId: id });
  return NextResponse.json({ detail: await loadClientDetail(id) });
}
