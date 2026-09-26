import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { getProfile } from "@/lib/integrations/gmail-read";
import { defaultMailbox } from "@/lib/gmail/sync";

// Próbne wywołanie z zakresem gmail.readonly — sprawdza, czy zakres jest
// dopisany w Google Admin (prompt 3, 4.1). Tylko ADMIN.
export async function POST() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const mailbox = defaultMailbox();
  if (!mailbox) return NextResponse.json({ ok: false, message: "Brak GOOGLE_IMPERSONATED_USER w .env." });
  try {
    const p = await getProfile(mailbox);
    return NextResponse.json({ ok: true, message: `Dostęp do odczytu działa — skrzynka ${p.emailAddress} (${p.messagesTotal.toLocaleString("pl-PL")} wiadomości).` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const scope = /unauthorized_client|access_denied|scope/i.test(msg);
    return NextResponse.json({
      ok: false,
      message: scope
        ? "Brak zakresu gmail.readonly w Google Admin (Przekazywanie uprawnień w całej domenie) — dopisz go do tego samego Client ID. Zmiana działa po kilku minutach."
        : msg,
    });
  }
}
