import { NextRequest } from "next/server";
import { json, withAgent } from "@/lib/agent-api/handler";
import { listRules } from "@/lib/porzadki/cleanup-rules";

// API agenta: reguły porządków — do przeczytania przed pracą.
export async function GET(req: NextRequest) {
  return withAgent(req, async () => json({ rules: await listRules() }));
}
