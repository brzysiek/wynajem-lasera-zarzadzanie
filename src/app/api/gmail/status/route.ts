import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { getGmailStatus } from "@/lib/gmail/sync";

// Stan historii e-maili (skrzynki, postęp importu). Tylko ADMIN.
export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  return NextResponse.json(await getGmailStatus());
}
