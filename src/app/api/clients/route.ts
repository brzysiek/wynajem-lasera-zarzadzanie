import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { normalizePolishPhone } from "@/lib/reminders";
import { parseClientPatch, parseContactInput } from "@/lib/clients/validate";
import { logInfo } from "@/lib/logger";

// Nowy klient z panelu (spec 3.2 „+ Nowy klient”) — od razu z osobą
// kontaktową (główną). ADMIN/STAFF. Do HubSpota nic nie idzie, dopóki nie
// zostanie włączone odsyłanie (krok 1E).
export async function POST(req: NextRequest) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });

  const client = parseClientPatch({ ...body.client, name: body.client?.name ?? "" });
  if (!client.ok) return NextResponse.json({ message: client.message }, { status: 400 });
  const contact = parseContactInput(body.contact ?? {}, { normalizePhone: normalizePolishPhone }, { requireName: true });
  if (!contact.ok) return NextResponse.json({ message: contact.message }, { status: 400 });

  const { deviceInterests, ...clientData } = client.data;
  const created = await prisma.client.create({
    data: {
      ...clientData,
      name: clientData.name as string,
      ...(deviceInterests?.length ? { deviceInterests } : {}),
      contacts: { create: { ...contact.data, isPrimary: true } },
    },
    select: { id: true },
  });
  logInfo("client_created", { userId: session.user.id, clientId: created.id });
  return NextResponse.json({ id: created.id });
}
