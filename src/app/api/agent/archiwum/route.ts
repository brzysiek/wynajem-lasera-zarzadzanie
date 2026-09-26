import { NextRequest } from "next/server";
import { json, withAgent } from "@/lib/agent-api/handler";
import { listArchive } from "@/lib/porzadki/archive";

// API agenta: podgląd archiwum (?typ=client|lead&powod=&paczka=&q=) — żeby
// nie proponować ponownie tego, co już zarchiwizowane. Archiwizuje ADMIN.
export async function GET(req: NextRequest) {
  return withAgent(req, async () => {
    const sp = req.nextUrl.searchParams;
    return json({ rows: await listArchive({ type: sp.get("typ"), reason: sp.get("powod"), batch: sp.get("paczka"), q: sp.get("q") }) });
  });
}
