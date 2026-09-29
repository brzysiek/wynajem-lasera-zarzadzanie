import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { parseSince, upsertClientPrice } from "@/lib/clients/terms";
import { loadClientDetail } from "@/lib/clients/load";
import { PRICE_SOURCES, isTermsDevice } from "@/lib/clients/terms-rules";
import { logInfo } from "@/lib/logger";

// Wniosek 28: jeden wyjątek ceny klienta (autozapis na karcie, „zmień i
// zapisz w warunkach” w rezerwacji). { device, days, priceNet | null (usuń),
// source, sourceRef, since RRRR-MM-DD }. Tylko biuro; agent — propozycje.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || !isTermsDevice(b.device)) return NextResponse.json({ message: "Wybierz urządzenie / wariant." }, { status: 400 });
  const days = Number(b.days);
  if (!Number.isInteger(days) || days < 1 || days > 31) return NextResponse.json({ message: "Liczba dni 1–31." }, { status: 400 });
  let priceNet: number | null = null;
  if (b.priceNet != null && b.priceNet !== "") {
    priceNet = Number(String(b.priceNet).replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(priceNet) || priceNet <= 0 || priceNet > 100000) return NextResponse.json({ message: "Cena netto musi być liczbą większą od zera." }, { status: 400 });
    priceNet = Math.round(priceNet * 100) / 100;
  }
  const source = typeof b.source === "string" && (PRICE_SOURCES as readonly string[]).includes(b.source) ? b.source : null;
  const sourceRef = typeof b.sourceRef === "string" && b.sourceRef.trim() ? b.sourceRef.trim().slice(0, 191) : null;
  const res = await upsertClientPrice(id, { device: b.device, days, priceNet, source, sourceRef, since: parseSince(b.since) }, { userId: session.user.id });
  if (!res.ok) return NextResponse.json({ message: res.message }, { status: 400 });
  logInfo("client_price_row_saved", { userId: session.user.id, clientId: id, device: b.device, days, removed: priceNet == null });
  return NextResponse.json({ detail: await loadClientDetail(id) });
}
