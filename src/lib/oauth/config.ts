import { BASE_PATH } from "@/lib/base-path";

// Publiczne adresy serwera MCP i OAuth. Źródło: NEXTAUTH_URL (sam origin,
// jak w linkach resetu hasła) + basePath. Na produkcji basePath jest pusty,
// więc /.well-known/* leży w korzeniu domeny — tam, gdzie szuka go claude.ai.
export function publicOrigin(): string {
  const raw = process.env.NEXTAUTH_URL || "http://localhost:3000";
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

export const publicBase = () => `${publicOrigin()}${BASE_PATH}`;
export const mcpResourceUrl = () => `${publicBase()}/api/mcp`;
export const oauthIssuer = () => publicBase();
export const resourceMetadataUrl = () => `${publicBase()}/.well-known/oauth-protected-resource`;
export const OAUTH_SCOPE = "panel";

export function protectedResourceMetadata() {
  return {
    resource: mcpResourceUrl(),
    authorization_servers: [oauthIssuer()],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Panel WynajemLasera.pl — agent",
  };
}

export function authorizationServerMetadata() {
  const base = publicBase();
  return {
    issuer: oauthIssuer(),
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [OAUTH_SCOPE],
  };
}
