import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { loadDeliverySettings, saveDeliverySettings } from "@/lib/clients/delivery";
import { logInfo } from "@/lib/logger";

// Ustawienia → Cennik: baza (skąd liczymy trasy) i stawki stref transportu.
export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  return NextResponse.json(await loadDeliverySettings());
}

export async function PUT(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { baseAddress?: unknown; zonePrices?: unknown } | null;
  if (!body) return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  let zonePrices: Record<string, number | null> | undefined;
  if (body.zonePrices !== undefined) {
    if (!body.zonePrices || typeof body.zonePrices !== "object") return NextResponse.json({ message: "Nieprawidłowe stawki." }, { status: 400 });
    zonePrices = {};
    for (const [k, v] of Object.entries(body.zonePrices as Record<string, unknown>)) {
      if (v === null || v === "") zonePrices[k] = null;
      else {
        const n = Number(String(v).replace(",", "."));
        if (!Number.isFinite(n) || n < 0 || n > 100000) return NextResponse.json({ message: `Nieprawidłowa stawka strefy ${k}.` }, { status: 400 });
        zonePrices[k] = Math.round(n * 100) / 100;
      }
    }
  }
  const result = await saveDeliverySettings({ baseAddress: typeof body.baseAddress === "string" ? body.baseAddress : undefined, zonePrices });
  if (!result.ok) return NextResponse.json({ message: result.message }, { status: 400 });
  logInfo("delivery_settings_saved", { userId: session.user.id, base: typeof body.baseAddress === "string" });
  return NextResponse.json(await loadDeliverySettings());
}
