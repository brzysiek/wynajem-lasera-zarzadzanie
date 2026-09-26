import { parseDecideBody } from "@/lib/history/decide";
import { parseInvoiceDecision } from "@/lib/history/invoice-import";
import { decideHistoryLogged, decideInvoicesLogged } from "@/lib/history/decide-logged";
import { AgentApiError } from "@/lib/agent-api/handler";

// Decyzja agenta w dopasowaniach (instrukcja „Rola agenta”: potwierdzenie,
// odrzucenie, przypisanie do innego klienta, pominięcie — też faktury).
// Polskie parametry: rodzaj kalendarz|faktury, akcja przypisz|pomin|cofnij,
// klucze (grupy z kalendarzy) albo faktury_ids, klient_id (przy przypisz).
const ACTION: Record<string, "assign" | "ignore" | "reset"> = { przypisz: "assign", assign: "assign", pomin: "ignore", ignore: "ignore", cofnij: "reset", reset: "reset" };

export async function agentMatchDecision(a: Record<string, unknown>, userId: string) {
  const action = ACTION[String(a.akcja ?? a.action ?? "").toLowerCase()];
  if (!action) throw new AgentApiError("akcja: przypisz, pomin albo cofnij.");
  const clientId = typeof a.klient_id === "string" ? a.klient_id : undefined;
  if (a.rodzaj === "faktury") {
    const parsed = parseInvoiceDecision({ action, ids: a.faktury_ids, clientId });
    if (typeof parsed === "string") throw new AgentApiError(parsed);
    return decideInvoicesLogged(parsed, userId);
  }
  if (a.rodzaj !== "kalendarz") throw new AgentApiError("rodzaj: kalendarz albo faktury.");
  const parsed = parseDecideBody({ action, keys: a.klucze, clientId });
  if (typeof parsed === "string") throw new AgentApiError(parsed);
  return decideHistoryLogged(parsed, userId);
}
