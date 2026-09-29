import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { loadClientStatusInfo } from "@/lib/clients/load";
import { arrivalRhythmLabel } from "@/lib/clients/status";
import { STATUS_LABEL } from "@/lib/clients/labels";
import { INVOICE_MODE_LABEL, TERMS_DEVICE_LABEL, TRANSPORT_SOURCE_LABEL, parseInvoiceMode, type TermsDeviceCode } from "@/lib/clients/terms-rules";

// Wniosek 29: ściąga o kliencie pod polem „Klient” w formularzu rezerwacji —
// status, rytm, ostatni wynajem (urządzenie), najbliższe terminy, skrót
// warunków — oraz osoby klienta do pola „Osoba na miejscu”.
const PAY: Record<string, string> = { GOTOWKA: "gotówka", PRZELEW: "przelew", OBA: "gotówka i przelew" };
const dm = (d: Date) => d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", timeZone: "Europe/Warsaw" });

export async function GET(req: NextRequest) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const id = req.nextUrl.searchParams.get("klient") ?? "";
  const exclude = req.nextUrl.searchParams.get("bez");
  const now = new Date();
  const c = await prisma.client.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      shortName: true,
      city: true,
      transportPriceNet: true,
      transportSource: true,
      paymentForm: true,
      invoiceMode: true,
      resignedAt: true,
      prices: { orderBy: [{ device: "asc" }, { days: "asc" }], select: { device: true, days: true, priceNet: true } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { id: true, firstName: true, lastName: true, phone: true, isPrimary: true } },
    },
  });
  if (!c) return NextResponse.json({ message: "Nie znaleziono klienta." }, { status: 404 });
  const [info, last, next] = await Promise.all([
    loadClientStatusInfo([c.id], now),
    prisma.rental.findFirst({
      where: { clientId: c.id, deletedInGoogle: false, eventType: "WYNAJEM", startsAt: { lte: now }, ...(exclude ? { id: { not: exclude } } : {}) },
      orderBy: { startsAt: "desc" },
      select: { startsAt: true, device: { select: { name: true } } },
    }),
    prisma.rental.findMany({
      where: { clientId: c.id, deletedInGoogle: false, startsAt: { gt: now }, ...(exclude ? { id: { not: exclude } } : {}) },
      orderBy: { startsAt: "asc" },
      take: 3,
      select: { startsAt: true },
    }),
  ]);
  const st = info.get(c.id);
  const terms = [
    ...c.prices.map((p) => `${TERMS_DEVICE_LABEL[p.device as TermsDeviceCode] ?? p.device} ${p.days} ${p.days === 1 ? "dzień" : "dni"} ${Number(p.priceNet)}`),
    c.transportPriceNet != null
      ? `transport ${Number(c.transportPriceNet)} (${c.transportSource ? (TRANSPORT_SOURCE_LABEL[c.transportSource as keyof typeof TRANSPORT_SOURCE_LABEL] ?? "ustalony") : "ustalony"})`
      : "transport do ustalenia",
    parseInvoiceMode(c.invoiceMode) ? INVOICE_MODE_LABEL[parseInvoiceMode(c.invoiceMode)!] : null,
    c.paymentForm ? PAY[c.paymentForm] : null,
  ].filter(Boolean);
  return NextResponse.json({
    client: {
      id: c.id,
      name: c.name,
      shortName: c.shortName,
      city: c.city,
      status: st ? STATUS_LABEL[st.status] : null,
      resigned: c.resignedAt != null,
      rhythm: st ? arrivalRhythmLabel(st.realized) : null,
      lastRental: last ? `${dm(last.startsAt)} (${last.device.name})` : null,
      next: next.map((r) => dm(r.startsAt)),
      terms: terms.join(" · "),
      individual: c.prices.length > 0,
    },
    contacts: c.contacts.map((p) => ({ id: p.id, name: [p.firstName, p.lastName].filter(Boolean).join(" ") || "(bez nazwiska)", phone: p.phone, isPrimary: p.isPrimary })),
  });
}
