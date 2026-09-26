import { NextResponse } from "next/server";
import { protectedResourceMetadata } from "@/lib/oauth/config";

// RFC 9728 — metadane chronionego zasobu (serwer MCP /api/mcp). Także pod
// /.well-known/oauth-protected-resource/api/mcp (claude.ai sprawdza oba).
export function GET() {
  return NextResponse.json(protectedResourceMetadata(), { headers: { "Cache-Control": "public, max-age=300" } });
}
