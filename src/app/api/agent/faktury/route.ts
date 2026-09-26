import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, withAgent, AgentApiError } from "@/lib/agent-api/handler";
import { dayParam, pagination } from "@/lib/agent-api/token";

// API agenta: faktury z Fakturowni (kopia w bazie panelu) — lista z
// paginacją. Filtry: od=, do= (data sprzedaży), klient=, nip=, stan=
// (dopasowanie do klienta), bez_klienta=1, bez_wynajmu=1.
export async function GET(req: NextRequest) {
  return withAgent(req, async () => {
    const sp = req.nextUrl.searchParams;
    const from = dayParam(sp.get("od"));
    const to = dayParam(sp.get("do"));
    if (from === "invalid" || to === "invalid") throw new AgentApiError("od / do: data RRRR-MM-DD.");
    const where = {
      ...(from || to ? { sellDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(sp.get("klient") ? { clientId: sp.get("klient") } : {}),
      ...(sp.get("nip") ? { buyerTaxNo: sp.get("nip")!.replace(/\D/g, "") } : {}),
      ...(sp.get("stan") ? { matchState: sp.get("stan") as "UNMATCHED" } : {}),
      ...(sp.get("bez_klienta") === "1" ? { clientId: null } : {}),
      ...(sp.get("bez_wynajmu") === "1" ? { rentalId: null } : {}),
    };
    const p = pagination(sp);
    const [total, rows] = await Promise.all([
      prisma.clientInvoice.count({ where }),
      prisma.clientInvoice.findMany({
        where,
        orderBy: { sellDate: "desc" },
        skip: p.skip,
        take: p.perPage,
        include: { client: { select: { name: true } } },
      }),
    ]);
    return json({
      items: rows.map((r) => ({
        id: r.id,
        fakturowniaInvoiceId: r.fakturowniaInvoiceId,
        number: r.number,
        issueDate: r.issueDate.toISOString().slice(0, 10),
        sellDate: r.sellDate.toISOString().slice(0, 10),
        paymentTo: r.paymentTo ? r.paymentTo.toISOString().slice(0, 10) : null,
        buyerName: r.buyerName,
        buyerTaxNo: r.buyerTaxNo,
        totalNet: r.totalNet.toString(),
        totalGross: r.totalGross.toString(),
        positions: r.positionsSummary,
        paymentType: r.paymentType,
        clientId: r.clientId,
        clientName: r.client?.name ?? null,
        rentalId: r.rentalId,
        matchState: r.matchState,
        matchMethod: r.matchMethod,
      })),
      page: p.page,
      perPage: p.perPage,
      total,
      pages: Math.max(1, Math.ceil(total / p.perPage)),
    });
  });
}
