import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { loadClientRows } from "@/lib/clients/load";
import { loadUnassignedRentals, type UnassignedRental } from "@/lib/clients/rental-match";
import { seasonWindow } from "@/lib/clients/list-rules";
import { countPendingHistory } from "@/lib/history/review-load";
import { logError } from "@/lib/logger";
import { ClientsList, type UnassignedSummary } from "@/components/clients/list/clients-list";
import { AgentModeProvider } from "@/components/clients/client-forms";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

// Rezerwacje bez klienta (wniosek 13) do pasa „Do zrobienia dziś”.
function summarize(list: UnassignedRental[]): UnassignedSummary {
  const months = [...new Set(list.map((u) => new Date(u.startsAt).getMonth()))].sort((a, b) => a - b);
  const examples = list
    .filter((u) => u.candidates[0])
    .slice(0, 3)
    .map((u) => ({ name: u.candidates[0].shortName ?? u.candidates[0].name.split(/\s+/).slice(0, 2).join(" "), at: u.startsAt }));
  return {
    count: list.length,
    months: months.length === 0 ? "" : months.length === 1 ? ROMAN[months[0]] : `${ROMAN[months[0]]}–${ROMAN[months[months.length - 1]]}`,
    examples,
  };
}

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireClientsPageAccess();
  const query = await searchParams;
  const today = new Date();
  // Błąd dopasowania rezerwacji nie może zablokować listy.
  const unassigned = await loadUnassignedRentals({ now: today }).catch((err) => {
    logError("unassigned_rentals_load_failed", err);
    return [] as UnassignedRental[];
  });
  const [rows, pendingHistory] = await Promise.all([loadClientRows(today, { unassigned }), countPendingHistory()]);
  const w = seasonWindow(today);
  return (
    <AgentModeProvider agent={session.user.role === "AGENT"}>
      <ClientsList
        rows={rows}
        pendingHistory={pendingHistory + unassigned.length}
        unassigned={summarize(unassigned)}
        season={{ label: w.label, baseLabel: w.baseLabel, seasonLabel: w.seasonLabel, baseMonths: w.baseMonths, seasonMonths: w.seasonMonths, flip: w.flip }}
        todayIso={today.toISOString()}
        initialQuery={query}
      />
    </AgentModeProvider>
  );
}
