/**
 * Tests for signup country detection.
 *
 * `next/headers`'s `headers()` is mocked to return a plain `Headers` — a real
 * `Request` is never available in the one caller (`signIn` in `auth.ts`), so
 * this pins the whole point of the module: a `{ headers }` shape is enough for
 * `geolocation()` to read the same edge header a real request would carry.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockHeaders = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => mockHeaders(),
}));

import { detectSignupCountry } from "./geo";

function headersWithCountry(country: string | null): Headers {
  const h = new Headers();
  if (country !== null) h.set("x-vercel-ip-country", country);
  return h;
}

beforeEach(() => {
  mockHeaders.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("detectSignupCountry", () => {
  it("reads the ISO code off the Vercel geo header", async () => {
    mockHeaders.mockResolvedValue(headersWithCountry("GB"));
    await expect(detectSignupCountry()).resolves.toBe("GB");
  });

  it("normalises to uppercase", async () => {
    mockHeaders.mockResolvedValue(headersWithCountry("tr"));
    await expect(detectSignupCountry()).resolves.toBe("TR");
  });

  it("is null when the header is absent (local dev, no geo data)", async () => {
    mockHeaders.mockResolvedValue(headersWithCountry(null));
    await expect(detectSignupCountry()).resolves.toBeNull();
  });

  it("is null for a value that is not a plausible 2-letter code", async () => {
    mockHeaders.mockResolvedValue(headersWithCountry("ZZZ"));
    await expect(detectSignupCountry()).resolves.toBeNull();

    mockHeaders.mockResolvedValue(headersWithCountry("1;DROP TABLE players"));
    await expect(detectSignupCountry()).resolves.toBeNull();
  });
});
