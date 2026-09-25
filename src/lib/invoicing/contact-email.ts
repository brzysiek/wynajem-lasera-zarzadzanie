import { prisma } from "@/lib/prisma";

export type InvoiceContactEmail =
  | { ok: true; email: string; startsAt: Date; endsAt: Date }
  | { ok: false; message: string };

// Adres e-mail kontrahenta dla danej faktury Fakturowni — WYŁĄCZNIE z
// HubSpota (Rental.contactEmailCache), nigdy z karty kontrahenta w
// Fakturowni (bywa nieaktualna/wpisywana ręcznie, ustalone z użytkownikiem).
// Wymaga więc, żeby ta faktura była powiązana z wynajmem w tej apce
// (RentalFinance.fakturowniaInvoiceId) — starsze faktury wystawione ręcznie
// w Fakturowni z pominięciem apki nie mają takiego powiązania. Używane przez
// oba route'y w src/app/api/fakturownia/invoices/[id]/{create-draft,
// remind-draft}, żeby nie dublować tej samej logiki/komunikatów błędów.
export async function resolveInvoiceContactEmail(invoiceId: number): Promise<InvoiceContactEmail> {
  const rentalFinance = await prisma.rentalFinance.findFirst({
    where: { fakturowniaInvoiceId: invoiceId },
    include: { rental: true },
  });
  if (!rentalFinance) {
    return { ok: false, message: "Ta faktura nie jest powiązana z wynajmem w tej apce — nie znamy adresu e-mail z HubSpota." };
  }
  const email = rentalFinance.rental.contactEmailCache?.trim();
  if (!email) {
    return {
      ok: false,
      message: "Kontakt HubSpot dla tego wynajmu nie ma zapisanego adresu e-mail — uzupełnij w HubSpot i odśwież kontakt na wynajmie.",
    };
  }
  return { ok: true, email, startsAt: rentalFinance.rental.startsAt, endsAt: rentalFinance.rental.endsAt };
}
