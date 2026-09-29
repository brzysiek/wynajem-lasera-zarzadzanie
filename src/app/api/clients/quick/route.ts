import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { quickCreateClient } from "@/lib/clients/quick-create";
import { logInfo } from "@/lib/logger";

// „+ Nowy klient” z formularza rezerwacji (wniosek 23). ADMIN/STAFF — agent
// zgłasza propozycję klient_nowy. 409 + duplicates = „Czy to ta klientka?”.
export async function POST(req: NextRequest) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  const res = await quickCreateClient(
    { name: String(body.name ?? ""), phone: body.phone ?? null, email: body.email ?? null, city: body.city ?? null, force: body.force === true },
    { userId: session.user.id, source: "nowy klient z formularza rezerwacji" },
  );
  if (!res.ok) return NextResponse.json({ message: res.message, duplicates: res.duplicates ?? [] }, { status: res.duplicates?.length ? 409 : 400 });
  logInfo("client_quick_created", { userId: session.user.id, clientId: res.id });
  return NextResponse.json({ id: res.id });
}
