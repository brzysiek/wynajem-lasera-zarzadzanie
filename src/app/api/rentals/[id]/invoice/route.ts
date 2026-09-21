import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { findClientByTaxNo, createInvoice } from "@/lib/integrations/fakturownia";
import { buildInvoicePositions } from "@/lib/invoicing/positions";
import { financeDto } from "@/lib/finance";
import { logInfo, logWarn, logError } from "@/lib/logger";

function bad(message: string, status = 400) {
  return NextResponse.json({ message }, { status });
}

// Wystawia fakturę VAT w Fakturowni dla wynajmu z doliczonym VAT (gotówka
// albo przelew — sposób płatności nie ma znaczenia, liczy się tylko
// vatApplicable). Ręczny przycisk (biuro klika w panelu rozliczenia) — nie ma tu żadnej
// automatyki/crona. Dwa różne "nieudane" wyniki: 400/502 = coś poszło źle po
// stronie API/danych wejściowych; 200 z `found: false` = wynik prawidłowy,
// tylko kontrahenta nie ma w Fakturowni (biuro wystawia ręcznie).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return bad("Brak uprawnień.", 403);

  const { id } = await params;
  const rental = await prisma.rental.findUnique({ where: { id }, include: { device: true, finance: true } });
  if (!rental) return bad("Nie znaleziono wynajmu.", 404);
  if (!rental.finance) return bad("Wynajem nie ma jeszcze rozliczenia.");
  // Decyzja biznesowa: brak "doliczyć VAT" = to w ogóle nie jest wynajem,
  // dla którego wystawia się fakturę. Sposób płatności (gotówka/przelew)
  // NIE jest tu warunkiem — gotówka + VAT też dostaje fakturę.
  if (!rental.finance.vatApplicable) {
    return bad("Fakturę wystawia się tylko dla rozliczeń z doliczonym VAT.");
  }
  if (rental.finance.fakturowniaInvoiceId) {
    return bad("Faktura dla tego wynajmu już została wystawiona.");
  }

  const nip = rental.contactNipCache?.trim();
  if (!nip) {
    await prisma.rentalFinance.update({
      where: { rentalId: id },
      data: { invoiceError: "Brak NIP kontrahenta — uzupełnij w HubSpot i odśwież kontakt na wynajmie." },
    });
    logWarn("fakturownia_invoice_missing_nip", { userId: session.user.id, rentalId: id });
    return NextResponse.json({ found: false, message: "Brak NIP kontrahenta — uzupełnij w HubSpot i odśwież kontakt na wynajmie." });
  }

  try {
    const client = await findClientByTaxNo(nip);
    if (!client) {
      await prisma.rentalFinance.update({
        where: { rentalId: id },
        data: { invoiceError: `Nie znaleziono kontrahenta w Fakturowni (NIP: ${nip}) — wystaw fakturę ręcznie.` },
      });
      logInfo("fakturownia_invoice_client_not_found", { userId: session.user.id, rentalId: id, nip });
      return NextResponse.json({
        found: false,
        message: `Nie znaleziono kontrahenta w Fakturowni (NIP: ${nip}) — wystaw fakturę ręcznie.`,
      });
    }

    const positions = buildInvoicePositions({
      eventType: rental.eventType,
      deviceName: rental.device.name,
      startsAt: rental.startsAt,
      endsAt: rental.endsAt,
      finance: rental.finance,
    });
    if (positions.length === 0) return bad("Brak pozycji do wystawienia — sprawdź rozliczenie wynajmu.");

    const invoice = await createInvoice({ clientId: client.id, sellDate: rental.endsAt, positions });

    const updated = await prisma.rentalFinance.update({
      where: { rentalId: id },
      data: {
        fakturowniaInvoiceId: invoice.id,
        fakturowniaInvoiceNumber: invoice.number,
        invoiceIssuedAt: new Date(),
        invoiceError: null,
      },
    });

    logInfo("fakturownia_invoice_issued", {
      userId: session.user.id,
      rentalId: id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
    });

    return NextResponse.json({ found: true, finance: financeDto(updated) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.rentalFinance
      .update({ where: { rentalId: id }, data: { invoiceError: message } })
      .catch(() => {});
    logError("fakturownia_invoice_failed", err, { userId: session.user.id, rentalId: id });
    return NextResponse.json({ message }, { status: 502 });
  }
}

// Czyści zapisany numer faktury (nie rusza niczego w Fakturowni) — dla
// sytuacji, gdy faktura została skasowana/skorygowana po stronie Fakturowni
// i trzeba wystawić nową dla tego samego wynajmu. Bez tego POST wyżej
// odmawia (fakturowniaInvoiceId już ustawiony).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return bad("Brak uprawnień.", 403);

  const { id } = await params;
  const rental = await prisma.rental.findUnique({ where: { id }, include: { finance: true } });
  if (!rental) return bad("Nie znaleziono wynajmu.", 404);
  if (!rental.finance) return bad("Wynajem nie ma jeszcze rozliczenia.");

  const updated = await prisma.rentalFinance.update({
    where: { rentalId: id },
    data: { fakturowniaInvoiceId: null, fakturowniaInvoiceNumber: null, invoiceIssuedAt: null, invoiceError: null },
  });

  logInfo("fakturownia_invoice_reset", { userId: session.user.id, rentalId: id });
  return NextResponse.json({ finance: financeDto(updated) });
}
