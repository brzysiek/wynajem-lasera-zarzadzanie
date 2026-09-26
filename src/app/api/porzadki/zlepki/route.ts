import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { listSuspectedBlobs } from "@/lib/clients/blob-load";

// Podejrzane zlepki klientów (kilka gabinetów pod jedną kartą) — odczyt.
export async function GET() {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  return NextResponse.json({ blobs: await listSuspectedBlobs() });
}
