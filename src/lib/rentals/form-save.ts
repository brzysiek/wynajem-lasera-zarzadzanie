import { prisma } from "@/lib/prisma";
import { clientCacheFields, contactCacheFields } from "@/lib/clients/cache";
import { saveRentalFinance, type OfficeFinanceInput } from "@/lib/finance";
import { upsertClientPrice } from "@/lib/clients/terms";
import { patchClient } from "@/lib/clients/update";
import { deviceCodeFor } from "@/lib/clients/terms-rules";
import { rentalDurationDays } from "@/lib/pricing/duration";
import { logWarn } from "@/lib/logger";

// Wniosek 29: wspólne kroki zapisu rezerwacji z formularza (POST i PATCH).

// Szkolenie: miejsce, prowadząca, liczba uczestniczek.
export function parseTraining(body: Record<string, unknown> | null, isTraining: boolean) {
  if (!isTraining) return { trainingPlace: null, trainingLead: null, trainingParticipants: null };
  const place = body?.trainingPlace === "U_NAS" ? "U_NAS" : body?.trainingPlace === "U_KLIENTKI" ? "U_KLIENTKI" : null;
  const lead = typeof body?.trainingLead === "string" && body.trainingLead.trim() ? body.trainingLead.trim().slice(0, 64) : null;
  const n = Number(body?.trainingParticipants);
  return { trainingPlace: place, trainingLead: lead, trainingParticipants: Number.isInteger(n) && n > 0 && n < 100 ? n : null };
}

// Dane kontaktu na wynajmie z klienta panelu (nie z HubSpota): firma, adres,
// NIP, transport + „osoba na miejscu” (jej telefon widzi kierowca).
export async function applyClientCaches(rentalId: string, clientId: string, contactId: string | null | undefined): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { name: true, street: true, zip: true, city: true, country: true, nip: true, transportPriceNet: true, contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { id: true, firstName: true, lastName: true, phone: true, email: true } } },
  });
  if (!client) return;
  const person = (contactId ? client.contacts.find((p) => p.id === contactId) : null) ?? client.contacts[0] ?? null;
  await prisma.rental.update({
    where: { id: rentalId },
    data: { ...clientCacheFields(client), ...(person ? { clientContactId: person.id, ...contactCacheFields(person) } : {}) },
  });
}

type FinanceBody = OfficeFinanceInput & { saveToTerms?: boolean };

// Po zapisie rozliczenia: „zmień i zapisz w warunkach” (nowa wersja wyjątku
// od dziś, rozliczenie wraca do „warunki klienta”) oraz pierwsza kwota
// transportu klienta bez transportu ustalonego → karta klienta (wniosek 28).
export async function afterFinanceSave(rentalId: string, finance: FinanceBody, userId: string): Promise<void> {
  const r = await prisma.rental.findUnique({
    where: { id: rentalId },
    select: { id: true, clientId: true, eventType: true, startsAt: true, endsAt: true, transportPrice: true, device: { select: { pricingCategory: true } }, finance: true, client: { select: { transportPriceNet: true } } },
  });
  if (!r?.clientId || !r.finance) return;
  if (finance.saveToTerms && r.finance.baseRentalPriceSource === "MANUAL") {
    const code = deviceCodeFor(r.eventType, r.device.pricingCategory, r.finance.deviceVariant);
    const days = rentalDurationDays(r.startsAt, r.endsAt);
    if (code) {
      const res = await upsertClientPrice(r.clientId, { device: code, days, priceNet: Number(r.finance.baseRentalPriceNet), source: "REZERWACJA", sourceRef: r.finance.baseRentalPriceOverrideNote, since: new Date() }, { userId });
      if (res.ok) {
        const { baseRentalPriceNet: _b, baseRentalPriceOverrideNote: _n, saveToTerms: _s, ...rest } = finance;
        void _b;
        void _n;
        void _s;
        await saveRentalFinance(r, rest);
      } else logWarn("rental_save_to_terms_failed", { rentalId, message: res.message });
    }
  }
  const transport = r.finance.transportPriceNet != null ? Number(r.finance.transportPriceNet) : 0;
  if (r.eventType === "WYNAJEM" && r.client && r.client.transportPriceNet == null && transport > 0) {
    await patchClient(r.clientId, { transportPriceNet: String(transport), transportSource: "REZERWACJA" }, { userId, role: "STAFF" }).catch((err) =>
      logWarn("rental_transport_to_client_failed", { rentalId, message: err instanceof Error ? err.message : String(err) }),
    );
  }
}

// Walidacja formularza przed zapisem: wariant (urządzenia z wariantami) i
// transport (klient bez transportu ustalonego) — komunikat albo null.
export async function validateRentalForm(input: { eventType: string; variantOptions: unknown; finance: unknown; clientId: string | null }): Promise<string | null> {
  if (input.eventType !== "WYNAJEM" || !input.finance || typeof input.finance !== "object") return null;
  const f = input.finance as { deviceVariant?: unknown; transportPriceNet?: unknown };
  const variants = Array.isArray(input.variantOptions) ? input.variantOptions : [];
  if (variants.length > 0 && !(typeof f.deviceVariant === "string" && f.deviceVariant)) return "Wybierz wariant urządzenia (np. 1 gł. / 2 gł., Dye-VL / iPixel).";
  if (input.clientId) {
    const c = await prisma.client.findUnique({ where: { id: input.clientId }, select: { transportPriceNet: true } });
    const t = typeof f.transportPriceNet === "string" ? f.transportPriceNet.trim() : f.transportPriceNet;
    if (c && c.transportPriceNet == null && (t == null || t === "")) return "Klient nie ma transportu ustalonego — wpisz kwotę transportu (zapisze się w karcie klienta).";
  }
  return null;
}
