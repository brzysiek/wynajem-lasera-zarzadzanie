import { describe, expect, it } from "vitest";
import { bearerToken, dayParam, generateToken, hashToken, paginate, pagination } from "./token";

describe("tokeny", () => {
  it("token ma prefiks, skrót to SHA-256 hex", () => {
    const t = generateToken();
    expect(t.token.startsWith("wla_")).toBe(true);
    expect(t.hash).toBe(hashToken(t.token));
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.token.startsWith(t.prefix)).toBe(true);
    expect(generateToken().token).not.toBe(t.token);
  });
  it("nagłówek Bearer", () => {
    expect(bearerToken("Bearer wla_abc")).toBe("wla_abc");
    expect(bearerToken("bearer  wla_abc ")).toBe("wla_abc");
    expect(bearerToken("Bearer xyz")).toBeNull();
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("Basic wla_abc")).toBeNull();
  });
});

describe("paginacja i daty", () => {
  it("strona i rozmiar w granicach", () => {
    expect(pagination(new URLSearchParams("strona=2&na_strone=10"))).toEqual({ page: 2, perPage: 10, skip: 10 });
    expect(pagination(new URLSearchParams("na_strone=999"))).toMatchObject({ perPage: 200 });
    expect(pagination(new URLSearchParams("strona=-3"))).toMatchObject({ page: 1 });
    expect(paginate([1, 2, 3, 4, 5], { page: 2, perPage: 2, skip: 2 })).toEqual({ items: [3, 4], page: 2, perPage: 2, total: 5, pages: 3 });
  });
  it("dayParam", () => {
    expect(dayParam(null)).toBeNull();
    expect(dayParam("2026-09-01")).toEqual(new Date("2026-09-01T00:00:00.000Z"));
    expect(dayParam("1.09.2026")).toBe("invalid");
  });
});
