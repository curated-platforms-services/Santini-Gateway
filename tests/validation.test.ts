import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://unused:unused@localhost:5432/unused";
process.env.SANTINI_ADMIN_TOKEN ??= "test-admin-token";
process.env.SANTINI_ALLOWED_SUBGRAPH_HOSTS ??= "accounts-subgraph";

const {
  validateCreateSubgraph,
  validateSubgraphName,
  validateSubgraphUrl,
  validateUpdateSubgraph
} = await import("../src/validation");

describe("subgraph validation", () => {
  test("accepts a valid internal subgraph", () => {
    expect(validateCreateSubgraph({
      name: "accounts",
      url: "http://accounts-subgraph:4001/graphql",
      enabled: true
    })).toEqual({
      name: "accounts",
      url: "http://accounts-subgraph:4001/graphql",
      enabled: true
    });
  });

  test("rejects unsafe names", () => {
    expect(() => validateSubgraphName("Accounts_Service")).toThrow(
      "name must match"
    );
  });

  test("rejects URLs with embedded credentials", () => {
    expect(() => validateSubgraphUrl("https://user:pass@accounts-subgraph/graphql"))
      .toThrow("must not contain credentials");
  });

  test("rejects hosts outside the configured allowlist", () => {
    expect(() => validateSubgraphUrl("https://metadata.google.internal/graphql"))
      .toThrow("not allowed");
  });

  test("requires a meaningful patch", () => {
    expect(() => validateUpdateSubgraph({})).toThrow(
      "at least one of url or enabled is required"
    );
  });
});