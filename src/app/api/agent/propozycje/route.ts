import { NextRequest } from "next/server";
import { json, readJson, withAgent } from "@/lib/agent-api/handler";
import { listAutoClasses, listChangeProposals, submitProposals } from "@/lib/porzadki/change-proposals";

// API agenta: propozycje zmian. GET ?status=&wykonana=&paczka=&klient= —
// m.in. odrzucone z komentarzem (nie proponuj ich ponownie). POST
// { propozycje: [...] } — hurtem, wynik osobno dla każdej pozycji.
export async function GET(req: NextRequest) {
  return withAgent(req, async () => {
    const sp = req.nextUrl.searchParams;
    const w = sp.get("wykonana");
    const [proposals, classes] = await Promise.all([
      listChangeProposals({
        status: sp.get("status"),
        batch: sp.get("paczka"),
        clientId: sp.get("klient"),
        executed: w === "1" || w === "true" ? true : w === "0" || w === "false" ? false : null,
      }),
      listAutoClasses(),
    ]);
    return json({ proposals, autoApprovedClasses: classes });
  });
}

export async function POST(req: NextRequest) {
  return withAgent(req, async (agent) => {
    const body = await readJson(req);
    return json({ results: await submitProposals(body.propozycje as unknown[], agent) }, 201);
  });
}
