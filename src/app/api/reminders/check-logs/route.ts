import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getReminderCheckLogs } from "@/lib/reminders";

const PAGE_SIZES = [10, 25, 50, 100, 500];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSizeParam = Number(searchParams.get("pageSize"));
  const pageSize = PAGE_SIZES.includes(pageSizeParam) ? pageSizeParam : 25;
  const activityOnly = searchParams.get("activityOnly") === "true";

  const result = await getReminderCheckLogs({ page, pageSize, activityOnly });
  return NextResponse.json(result);
}
