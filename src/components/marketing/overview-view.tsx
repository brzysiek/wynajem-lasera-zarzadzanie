import Link from "next/link";
import type { Overview, TodoItem, Tile } from "@/lib/marketing/overview";

// Marketing → Przegląd (wniosek 54, etap 1c): kafelki, lejek, „Skąd są rezerwacje”
// i „Do zrobienia”. Układ i etykiety jak w makiecie. Komponent bez stanu.

const PLN = (n: number) => `${Math.round(n).toLocaleString("pl-PL")} zł`;

function Compare({ t, label, money }: { t: Tile; label: string; money?: boolean }) {
  if (t.prev === 0 && t.value === 0) return <>vs {label}: bez zmian</>;
  const arrow = t.diff > 0 ? "▲" : t.diff < 0 ? "▼" : "•";
  const amount = money ? PLN(Math.abs(t.diff)) : Math.abs(t.diff).toLocaleString("pl-PL");
  return (
    <>
      vs {label}: <span className={t.diff > 0 ? "text-green-700" : t.diff < 0 ? "text-red-700" : ""}>{arrow} {amount}</span>
      {t.pct != null && t.diff !== 0 ? ` (${t.pct > 0 ? "+" : ""}${t.pct}%)` : ""}
    </>
  );
}

function KpiTile({ title, value, sub }: { title: string; value: React.ReactNode; sub: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="text-xs text-gray-500">{title}</div>
      <div className="mt-1 text-3xl font-bold leading-tight text-gray-900">{value}</div>
      <div className="mt-1 text-xs text-gray-500">{sub}</div>
    </div>
  );
}

const TODO_BADGE: Record<TodoItem["who"], string> = { Ania: "bg-[#B8530F] text-white", Tomek: "bg-[#1B4FD8] text-white", Info: "bg-gray-600 text-white" };
const TODO_BOX: Record<TodoItem["who"], string> = { Ania: "border-orange-200 bg-orange-50", Tomek: "border-blue-100 bg-blue-50", Info: "border-gray-200 bg-gray-50" };

export function OverviewView({ o, prevLabel, todo }: { o: Overview; prevLabel: string; todo: TodoItem[] }) {
  const maxBookings = Math.max(1, ...o.sources.map((s) => s.bookings));
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiTile title="Nowe zapytania" value={o.leads.value} sub={<Compare t={o.leads} label={prevLabel} />} />
        <KpiTile title="Oferty wysłane" value={o.offers.value} sub={o.offers.rateOfLeads != null ? `${o.offers.rateOfLeads}% zapytań` : "—"} />
        <KpiTile title="Rezerwacje" value={o.bookings.value} sub={o.bookings.rateOfLeads != null ? `${o.bookings.rateOfLeads}% zapytań` : "—"} />
        <KpiTile
          title="Przychód z rezerwacji"
          value={PLN(o.revenue.value)}
          sub={o.revenue.avgPerBooking != null ? `śr. ${PLN(o.revenue.avgPerBooking)} / rezerwacja` : <Compare t={o.revenue} label={prevLabel} money />}
        />
        <KpiTile title="Wydatki na reklamy" value={o.spend.hasCost ? PLN(o.spend.value) : "[—]"} sub={o.spend.hasCost ? "z importu kosztów Google Ads" : "po imporcie kosztów"} />
      </div>

      <section className="rounded-xl border border-gray-200 bg-white px-5 py-4">
        <h2 className="m-0 text-base font-semibold text-gray-900">Lejek: od zapytania do pieniędzy</h2>
        <p className="mb-3 mt-0 text-xs text-gray-500">Każdy krok pokazuje, ile osób przeszło dalej</p>
        <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
          <FunnelBox title="Zapytania" value={String(o.funnel.leads)} cls="bg-[#1B4FD8] text-white" />
          <FunnelArrow rate={o.funnel.offersRate} />
          <FunnelBox title="Oferta wysłana" value={String(o.funnel.offers)} cls="bg-[#3B6FE0] text-white" />
          <FunnelArrow rate={o.funnel.bookingsRate} />
          <FunnelBox title="Rezerwacja" value={String(o.funnel.bookings)} cls="bg-[#DCE6FB] text-[#1B3A8A]" />
          <FunnelArrow rate={null} />
          <FunnelBox title="Przychód" value={PLN(o.funnel.revenue)} cls="border border-green-200 bg-green-50 text-green-900" />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr_1fr]">
        <section className="rounded-xl border border-gray-200 bg-white px-5 py-4">
          <h2 className="m-0 mb-3 text-base font-semibold text-gray-900">Skąd są rezerwacje</h2>
          {o.sources.length === 0 ? (
            <p className="m-0 text-sm text-gray-400">Brak zapytań w tym okresie.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {o.sources.map((s) => (
                <li key={s.label} className="grid grid-cols-[minmax(110px,150px)_1fr_auto] items-center gap-3 text-sm">
                  <span className="text-gray-800">{s.label}</span>
                  <span className="h-5 overflow-hidden rounded bg-gray-100">
                    <span className={`block h-full rounded ${s.unknown ? "bg-[#B8530F]" : "bg-[#1B4FD8]"}`} style={{ width: `${(s.bookings / maxBookings) * 100}%` }} />
                  </span>
                  <span className="whitespace-nowrap text-right tabular-nums text-gray-700">{s.bookings === 0 ? "0" : `${s.bookings} · ${PLN(s.revenue)}`}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mb-0 mt-3 text-xs text-gray-500">Pomarańczowy = źródło nieznane. Im mniej, tym pewniej oceniamy reklamy.</p>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white px-5 py-4">
          <h2 className="m-0 mb-3 text-base font-semibold text-gray-900">Do zrobienia</h2>
          {todo.length === 0 ? (
            <p className="m-0 text-sm text-gray-400">Nic na dziś.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {todo.map((t) => (
                <li key={t.text} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm text-gray-900 ${TODO_BOX[t.who]}`}>
                  <span className={`mt-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold ${TODO_BADGE[t.who]}`}>{t.who}</span>
                  <span>
                    {t.text}{" "}
                    {t.linkLabel ? (
                      <Link href={t.href} className="text-[#1B4FD8] underline">
                        {t.linkLabel}
                      </Link>
                    ) : (
                      <Link href={t.href} className="text-xs text-[#1B4FD8] underline">
                        Ustawienia pomiaru
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function FunnelBox({ title, value, cls }: { title: string; value: string; cls: string }) {
  return (
    <div className={`flex-1 rounded-lg px-4 py-3 ${cls}`}>
      <div className="text-xs opacity-90">{title}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function FunnelArrow({ rate }: { rate: number | null }) {
  return (
    <div className="px-1 text-center text-xs font-semibold text-gray-600 md:min-w-[60px]">
      {rate != null ? `${rate}% ` : ""}
      <span aria-hidden="true">→</span>
    </div>
  );
}
