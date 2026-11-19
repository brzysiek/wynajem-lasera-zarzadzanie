// Marketing → Ruch na stronie (wniosek 54, etap 1c): na razie tylko pusty stan. Dane
// z anonimowego licznika ruszą po wdrożeniu etapu 2 wniosku #54 (osobne polecenie);
// sekcje poniżej są przygotowane tak, żeby etap 2 je wypełnił.
const Dash = () => <span className="text-gray-400">[—]</span>;

function Kpi({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="text-xs text-gray-500">{title}</div>
      <div className="mt-1 text-3xl font-bold text-gray-900">{children}</div>
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white px-5 py-4">
      <h2 className="m-0 text-base font-semibold text-gray-900">{title}</h2>
      {sub && <p className="m-0 mt-0.5 text-xs text-gray-500">{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function TrafficPage() {
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        Dane z naszego anonimowego licznika (bez ciasteczek) — liczy wszystkie wejścia, także osób, które odrzuciły baner. Ruszy po wdrożeniu etapu 2.
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi title="Wejścia na stronę"><Dash /></Kpi>
        <Kpi title="W tym z reklam"><Dash /></Kpi>
        <Kpi title="Akceptują baner cookies"><><Dash /> %</></Kpi>
        <Kpi title="Formularz: zaczęte → wysłane"><><Dash /> → <Dash /></></Kpi>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Skąd wchodzą">
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
            {["Google Ads", "Google organiczne", "Facebook / Instagram", "Wpisany adres / zakładka", "Inne strony"].map((l) => (
              <li key={l} className="flex justify-between"><span>{l}</span><Dash /></li>
            ))}
          </ul>
        </Card>
        <Card title="Strony: wejścia i wyjścia">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="py-1 text-left font-medium">Strona</th>
                  <th className="py-1 text-right font-medium">Wejścia</th>
                  <th className="py-1 text-right font-medium">Przewinięte</th>
                  <th className="py-1 text-right font-medium">Wyszli od razu</th>
                </tr>
              </thead>
              <tbody>
                {["Strona główna", "Wynajem LightSheer", "Wynajem Alma"].map((p) => (
                  <tr key={p} className="border-t border-gray-100">
                    <td className="py-1.5">{p}</td>
                    <td className="py-1.5 text-right"><Dash /></td>
                    <td className="py-1.5 text-right"><Dash /> %</td>
                    <td className="py-1.5 text-right"><Dash /> %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Gdzie rezygnują w formularzu" sub="Ostatnie pole przed porzuceniem i najczęstsze błędy">
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
            {["Telefon", "Termin wynajmu", "Wiadomość"].map((l) => (
              <li key={l} className="flex justify-between"><span>{l}</span><span><Dash /> osób</span></li>
            ))}
          </ul>
        </Card>
        <Card title="Gdzie klikają">
          <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-gray-300 px-4 text-center text-sm text-gray-500">
            Mapa kliknięć: zrzut strony z kropkami w miejscach kliknięć (telefon / komputer osobno)
          </div>
        </Card>
      </div>
    </div>
  );
}
