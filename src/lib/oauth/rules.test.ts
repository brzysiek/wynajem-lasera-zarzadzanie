import { describe, expect, it } from "vitest";
import { CLAUDE_CALLBACKS, CODE_TTL_MS, isAllowedRedirect, pkceChallenge, redirectMatches, redirectWithParams, verifyPkce } from "./rules";

const AI = "https://claude.ai/api/mcp/auth_callback";
const COM = "https://claude.com/api/mcp/auth_callback";

describe("adresy powrotu", () => {
  it("tylko claude.ai i claude.com", () => {
    expect(CLAUDE_CALLBACKS).toEqual([AI, COM]);
    expect(isAllowedRedirect(AI)).toBe(true);
    expect(isAllowedRedirect(COM)).toBe(true);
    for (const bad of [
      "http://localhost:3118/callback",
      "http://127.0.0.1:5555/callback",
      "https://evil.example/cb",
      "https://claude.ai/api/mcp/auth_callback/x",
      "https://claude.ai.evil.com/api/mcp/auth_callback",
      "http://claude.ai/api/mcp/auth_callback",
    ]) {
      expect(isAllowedRedirect(bad), bad).toBe(false);
    }
  });
  it("dopasowanie dokładne do zarejestrowanego", () => {
    expect(redirectMatches([AI], AI)).toBe(true);
    expect(redirectMatches([AI], COM)).toBe(false);
    expect(redirectMatches(["https://evil.example/cb"], "https://evil.example/cb")).toBe(false);
  });
  it("parametry doklejane do adresu", () => {
    expect(redirectWithParams(AI, { code: "abc", state: "x y", iss: null })).toBe(`${AI}?code=abc&state=x+y`);
  });
});

describe("PKCE S256 i kod", () => {
  it("przykład z RFC 7636", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(verifyPkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
    expect(verifyPkce("zly", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(false);
  });
  it("kod krótko ważny", () => {
    expect(CODE_TTL_MS).toBeLessThanOrEqual(5 * 60_000);
  });
});
