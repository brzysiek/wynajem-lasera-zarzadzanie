import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { BASE_PATH } from "@/lib/base-path";
import { validateAuthorize } from "@/lib/oauth/server";

// Ekran zgody OAuth dla konektora MCP (np. claude.ai). Otwiera się w okienku
// przy dodawaniu konektora; niezalogowanego proxy odsyła do logowania i
// wraca tu z tymi samymi parametrami. Zgodę wydaje tylko ADMIN, a dostęp
// zawsze należy do konta z rolą AGENT (hasło agenta nie jest potrzebne).

const CAN = [
  "czytać klientów, sygnały, kalendarz wynajmów, dopasowania, faktury i „FV bez faktury”",
  "czytać i pisać wnioski, uwagi, reguły (odczyt) i dziennik zmian",
  "zmieniać dane klientów i osób — zawsze ze źródłem, pewnością i paczką, z wpisem w dzienniku",
  "scalać duplikaty, dodawać notatki, przenosić kontakty z zapytań do klientów",
  "tworzyć zadania dla biura, zmieniać i komentować własne zadania",
];
const CANNOT = ["usuwać ani archiwizować czegokolwiek", "tworzyć ani zmieniać rezerwacji", "wystawiać faktur", "wysyłać SMS-ów ani maili", "zmieniać ustawień i użytkowników"];

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F3F5F7] p-4 text-[#14191F]">
      <div className="w-full max-w-lg rounded-xl border border-[#E9EDF1] bg-white p-6 shadow-sm">{children}</div>
    </main>
  );
}

export default async function OAuthAuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") sp.set(k, v);

  const [session, check] = await Promise.all([auth(), validateAuthorize(sp)]);
  if (!check.ok) {
    return (
      <Frame>
        <h1 className="text-lg font-semibold text-[#14191F]">Nie można połączyć</h1>
        <p className="mt-2 text-sm">{check.message}</p>
      </Frame>
    );
  }
  if (session?.user.role !== "ADMIN") {
    return (
      <Frame>
        <h1 className="text-lg font-semibold text-[#14191F]">Potrzebny administrator</h1>
        <p className="mt-2 text-sm">Dostęp dla konektora zatwierdza administrator panelu. Zaloguj się kontem administratora i spróbuj ponownie.</p>
      </Frame>
    );
  }
  const agents = await prisma.user.findMany({ where: { role: "AGENT" }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true } });
  const redirectHost = new URL(check.params.redirectUri).host;

  return (
    <Frame>
      <p className="text-xs font-semibold uppercase tracking-wide text-[#9AA1A8]">Panel WynajemLasera.pl</p>
      <h1 className="mt-1 text-xl font-semibold text-[#14191F]">{check.clientName ?? "Aplikacja"} prosi o dostęp do panelu</h1>
      <p className="mt-2 text-sm">
        Po zgodzie wrócisz do <b className="font-semibold">{redirectHost}</b>. Dostęp działa jako konto agenta, nie Twoje.
      </p>

      {agents.length === 0 ? (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Nie ma konta z rolą Agent AI. Nadaj ją w Ustawienia → Użytkownicy i spróbuj ponownie.
        </p>
      ) : (
        <form method="POST" action={`${BASE_PATH}/api/oauth/authorize`} className="mt-4">
          {["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "scope"].map((k) =>
            sp.get(k) != null ? <input key={k} type="hidden" name={k} value={sp.get(k) ?? ""} /> : null,
          )}
          <fieldset className="rounded-md border border-[#E9EDF1] p-3">
            <legend className="px-1 text-xs font-medium text-[#56606B]">Działa jako</legend>
            {agents.map((a, i) => (
              <label key={a.id} className="flex items-center gap-2 py-1 text-sm">
                <input type="radio" name="agent_user_id" value={a.id} defaultChecked={i === 0} required />
                <span className="font-medium text-[#14191F]">{a.name}</span>
                <span className="text-xs text-[#9AA1A8]">{a.email}</span>
              </label>
            ))}
          </fieldset>

          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="mb-1 font-semibold text-[#15754F]">Może</p>
              <ul className="list-disc space-y-1 pl-4 text-[13px]">
                {CAN.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1 font-semibold text-[#D93025]">Nie może</p>
              <ul className="list-disc space-y-1 pl-4 text-[13px]">
                {CANNOT.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-3 text-xs text-[#56606B]">
            Połączenie pojawi się w Ustawienia → Użytkownicy → Tokeny API przy koncie agenta — tam je unieważnisz. Każde wywołanie jest zapisywane.
          </p>

          <div className="mt-5 flex justify-end gap-2">
            <button type="submit" name="decision" value="deny" className="h-9 rounded-lg px-4 text-sm font-medium text-[#56606B] hover:bg-[#F3F5F7]">
              Odmów
            </button>
            <button type="submit" name="decision" value="allow" className="h-9 rounded-lg bg-[#0E5C58] px-4 text-sm font-semibold text-white hover:bg-[#083F3C]">
              Zezwól
            </button>
          </div>
        </form>
      )}
    </Frame>
  );
}
