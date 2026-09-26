import { NextRequest } from "next/server";
import { json, withAgent } from "@/lib/agent-api/handler";
import { loadFvWithoutInvoice } from "@/lib/invoicing/fv-check-load";

// API agenta: zakończone wynajmy ze znacznikiem FV bez faktury, z
// podpowiedzią prawdopodobnej faktury z Fakturowni.
export async function GET(req: NextRequest) {
  return withAgent(req, async () => json({ rentals: await loadFvWithoutInvoice() }));
}
