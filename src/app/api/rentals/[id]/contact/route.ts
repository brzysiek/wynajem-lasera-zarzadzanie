import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getHubspotContact, getHubspotContactUrl, formatHubspotAddress } from "@/lib/integrations/hubspot";
import { logInfo, logError } from "@/lib/logger";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;
  const rental = await prisma.rental.findUnique({ where: { id } });
  if (!rental) {
    return NextResponse.json({ message: "Nie znaleziono rezerwacji." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const contactId = typeof body?.contactId === "string" ? body.contactId.trim() : "";
  if (!contactId) {
    return NextResponse.json({ message: "Brak ID kontaktu." }, { status: 400 });
  }

  try {
    const contact = await getHubspotContact(contactId);
    const name = [contact.firstname, contact.lastname].filter(Boolean).join(" ").trim() || null;

    const updated = await prisma.rental.update({
      where: { id },
      data: {
        hubspotContactId: contact.id,
        contactNameCache: name,
        contactPhoneCache: contact.phone,
        contactEmailCache: contact.email,
        contactCompanyCache: contact.company,
        contactAddressCache: formatHubspotAddress(contact),
      },
      include: { device: true },
    });

    logInfo("rental_contact_assigned", { userId: session.user.id, rentalId: id, contactId: contact.id });

    return NextResponse.json({ rental: updated, contactUrl: getHubspotContactUrl(contact.id) });
  } catch (err) {
    logError("rental_contact_assign_failed", err, { userId: session.user.id, rentalId: id, contactId });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 502 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;
  const rental = await prisma.rental.findUnique({ where: { id } });
  if (!rental) {
    return NextResponse.json({ message: "Nie znaleziono rezerwacji." }, { status: 404 });
  }

  const updated = await prisma.rental.update({
    where: { id },
    data: {
      hubspotContactId: null,
      contactNameCache: null,
      contactPhoneCache: null,
      contactEmailCache: null,
      contactCompanyCache: null,
      contactAddressCache: null,
    },
    include: { device: true },
  });

  logInfo("rental_contact_unassigned", { userId: session.user.id, rentalId: id });

  return NextResponse.json({ rental: updated });
}
