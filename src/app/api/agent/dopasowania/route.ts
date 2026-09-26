import { NextRequest } from "next/server";
import { json, withAgent } from "@/lib/agent-api/handler";
import { loadHistoryReview } from "@/lib/history/review-load";

// API agenta: dopasowania historii — grupy wydarzeń z kalendarzy i faktury z
// Fakturowni ze stanem dopasowania (?stan=UNMATCHED|SUGGESTED|AUTO|CONFIRMED|IGNORED).
// Decyzje: POST /api/history/decide i /api/history/invoices/decide (sesja panelu).
export async function GET(req: NextRequest) {
  return withAgent(req, async () => {
    const state = req.nextUrl.searchParams.get("stan");
    const data = await loadHistoryReview();
    return json({
      totals: data.totals,
      groups: state ? data.groups.filter((g) => g.state === state) : data.groups,
      invoices: state ? data.invoices.filter((i) => i.state === state) : data.invoices,
    });
  });
}
