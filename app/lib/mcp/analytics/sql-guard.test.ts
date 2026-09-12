/**
 * Tests for the analytics SQL guard.
 *
 * Two halves, and the second is the one that has historically gone wrong in
 * every hand-rolled SQL check: the guard must refuse what it should refuse
 * WITHOUT refusing valid queries whose text merely LOOKS alarming. A semicolon
 * inside a string literal and the word "delete" inside a comment are both
 * perfectly ordinary, and a guard that rejects them is a guard people route
 * around.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROWS,
  MAX_ROWS,
  MAX_SQL_LENGTH,
  clampRows,
  guardAnalyticsSql,
  stripSqlNoise,
} from "./sql-guard";

const okSql = (sql: string, limit?: number) => {
  const result = guardAnalyticsSql(sql, limit);
  if (!result.ok) throw new Error(`expected accept, got: ${result.reason}`);
  return result;
};

const refusal = (sql: unknown) => {
  const result = guardAnalyticsSql(sql);
  return result.ok ? null : result.reason;
};

describe("stripSqlNoise", () => {
  it("blanks line comments", () => {
    expect(stripSqlNoise("SELECT 1 -- ; DROP\nFROM t")).not.toContain(";");
  });

  it("blanks nested block comments — Postgres nests them", () => {
    const out = stripSqlNoise("SELECT 1 /* a /* b ; */ c */ FROM t");
    expect(out).not.toContain(";");
    expect(out).toContain("FROM t");
  });

  it("blanks single-quoted strings, including doubled escapes", () => {
    expect(stripSqlNoise("SELECT * FROM t WHERE a = 'x;y'")).not.toContain(";");
    expect(stripSqlNoise("SELECT * FROM t WHERE a = 'it''s; fine'")).not.toContain(";");
  });

  it("blanks quoted identifiers", () => {
    expect(stripSqlNoise('SELECT "odd;name" FROM t')).not.toContain(";");
  });

  it("blanks dollar-quoted bodies", () => {
    expect(stripSqlNoise("SELECT $$a ; b$$")).not.toContain(";");
    expect(stripSqlNoise("SELECT $tag$a ; b$tag$")).not.toContain(";");
  });

  it("keeps token boundaries — a blanked span must not fuse its neighbours", () => {
    expect(stripSqlNoise("SELECT a'x'b")).toBe("SELECT a b");
  });
});

describe("guardAnalyticsSql — refusals", () => {
  it("refuses a non-string", () => {
    expect(refusal(undefined)).toMatch(/must be a string/);
    expect(refusal(42)).toMatch(/must be a string/);
  });

  it("refuses empty or whitespace", () => {
    expect(refusal("")).toMatch(/empty/);
    expect(refusal("   \n ")).toMatch(/empty/);
    expect(refusal(";")).toMatch(/empty/);
  });

  it("refuses a second statement", () => {
    expect(refusal("SELECT 1; DROP TABLE players")).toMatch(/one statement/);
    expect(refusal("SELECT 1;SELECT 2")).toMatch(/one statement/);
  });

  it("refuses anything that does not start SELECT or WITH", () => {
    expect(refusal("DELETE FROM scores")).toMatch(/SELECT or WITH/);
    expect(refusal("UPDATE players SET username = 'x'")).toMatch(/SELECT or WITH/);
    expect(refusal("INSERT INTO scores VALUES (1)")).toMatch(/SELECT or WITH/);
    expect(refusal("DROP SCHEMA mcp")).toMatch(/SELECT or WITH/);
    expect(refusal("GRANT SELECT ON players TO public")).toMatch(/SELECT or WITH/);
    expect(refusal("COPY players TO '/tmp/x'")).toMatch(/SELECT or WITH/);
  });

  it("is not fooled by a leading comment hiding a write", () => {
    expect(refusal("-- SELECT\nDELETE FROM scores")).toMatch(/SELECT or WITH/);
    expect(refusal("/* SELECT */ DROP TABLE t")).toMatch(/SELECT or WITH/);
  });

  it("refuses an over-long query", () => {
    expect(refusal(`SELECT ${"a".repeat(MAX_SQL_LENGTH)}`)).toMatch(/characters/);
  });
});

describe("guardAnalyticsSql — acceptances", () => {
  it("accepts a plain select and bounds it", () => {
    const { sql, limit } = okSql("SELECT * FROM players");
    expect(limit).toBe(DEFAULT_ROWS);
    expect(sql).toContain("SELECT * FROM players");
    expect(sql).toMatch(/AS mcp_result LIMIT 200$/);
  });

  it("accepts a CTE", () => {
    expect(okSql("WITH a AS (SELECT 1 AS n) SELECT * FROM a").sql).toContain("WITH a AS");
  });

  it("wraps rather than appends, so an existing LIMIT still parses", () => {
    const { sql } = okSql("SELECT * FROM players LIMIT 1");
    expect(sql).toMatch(/LIMIT 1\n\) AS mcp_result LIMIT 200$/);
  });

  it("strips one trailing semicolon — the only shape the wrapper cannot take", () => {
    expect(okSql("SELECT 1 AS x;").sql).not.toMatch(/;\s*\)/);
    expect(okSql("SELECT 1 AS x ;  \n").sql).not.toMatch(/;\s*\)/);
  });

  it("allows a semicolon inside a string literal", () => {
    expect(okSql("SELECT * FROM players WHERE username = 'a;b'").sql).toContain("'a;b'");
  });

  it("allows alarming words inside comments and strings", () => {
    expect(okSql("SELECT 1 AS x -- delete everything").ok).toBe(true);
    expect(okSql("SELECT * FROM players WHERE username = 'drop table'").ok).toBe(true);
  });

  it("accepts a leading comment before the SELECT", () => {
    expect(okSql("-- how many players?\nSELECT count(*) FROM players").ok).toBe(true);
  });

  it("is case-insensitive about the leading keyword", () => {
    expect(okSql("select 1 AS x").ok).toBe(true);
    expect(okSql("  wItH a AS (SELECT 1 AS n) SELECT * FROM a").ok).toBe(true);
  });
});

describe("clampRows", () => {
  it("defaults rather than maximising when unasked", () => {
    expect(clampRows(undefined)).toBe(DEFAULT_ROWS);
    expect(clampRows(Number.NaN)).toBe(DEFAULT_ROWS);
  });

  it("clamps instead of refusing", () => {
    expect(clampRows(0)).toBe(1);
    expect(clampRows(-5)).toBe(1);
    expect(clampRows(10_000)).toBe(MAX_ROWS);
    expect(clampRows(12.7)).toBe(12);
  });

  it("passes a sensible request through", () => {
    expect(guardAnalyticsSql("SELECT 1 AS x", 50)).toMatchObject({ ok: true, limit: 50 });
  });
});
