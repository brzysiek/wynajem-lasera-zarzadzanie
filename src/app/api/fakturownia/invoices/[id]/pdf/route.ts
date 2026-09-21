import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { getInvoicePdf } from "@/lib/integrations/fakturownia";

// Proxy PDF-a faktury z Fakturowni — przez nasz serwer, żeby token API nigdy
// nie trafiał do przeglądarki (URL z tokenem nie da się otworzyć wprost
// jako <a href>/<iframe> bez jego ujawnienia). `inline`, żeby otwierało się
// w karcie przeglądarki, nie pobierało od razu jako plik.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const { id } = await params;
  const invoiceId = Number(id);
  if (!Number.isInteger(invoiceId)) return NextResponse.json({ message: "Nieprawidłowe ID faktury." }, { status: 400 });

  try {
    const pdf = await getInvoicePdf(invoiceId);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="faktura-${invoiceId}.pdf"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 502 });
  }
}
