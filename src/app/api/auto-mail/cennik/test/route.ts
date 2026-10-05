import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { sendTestAutoMail } from "@/lib/leads/auto-mail";

// Próbna wysyłka maila automatycznego (kind: cennik | rezerwacja) — zapisana
// treść (dla rezerwacji z przykładowym zgłoszeniem) na podany adres.
export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const b = (await req.json().catch(() => null)) as { to?: unknown; name?: unknown; kind?: unknown } | null;
  const to = typeof b?.to === "string" ? b.to.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return NextResponse.json({ message: "Podaj poprawny adres e-mail." }, { status: 400 });
  const name = typeof b?.name === "string" && b.name.trim() ? b.name.trim() : null;
  const res = await sendTestAutoMail(to, name, b?.kind === "rezerwacja" ? "rezerwacja" : "cennik");
  if (!res.ok) return NextResponse.json({ message: `Nie wysłano: ${res.error}` }, { status: 502 });
  return NextResponse.json({ ok: true });
}
