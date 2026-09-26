import { NextRequest } from "next/server";
import { json, withAgent } from "@/lib/agent-api/handler";
import { RATE_LIMIT_PER_MINUTE } from "@/lib/agent-api/token";

// Kim jestem — sprawdzenie tokenu i limitów.
export async function GET(req: NextRequest) {
  return withAgent(req, async (agent) => json({ userId: agent.userId, name: agent.name, role: agent.role, rateLimitPerMinute: RATE_LIMIT_PER_MINUTE }));
}
