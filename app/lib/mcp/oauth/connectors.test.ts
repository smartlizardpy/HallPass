/**
 * Tests for the per-account connector grouping.
 *
 * Every case here is one whose failure is SILENT on screen: a count is a
 * confident-looking number, and a wrong one looks exactly like a right one. A
 * super admin deciding whether to remove somebody reads it as fact.
 */

import { describe, expect, it } from "vitest";
import {
  NO_CONNECTORS,
  connectorsFor,
  summarizeConnectors,
} from "./connectors";

const grant = (email: string, clientName: string) => ({ email, clientName });

describe("summarizeConnectors", () => {
  it("counts one account's grants and names the apps behind them", () => {
    const summaries = summarizeConnectors(
      [grant("a@x.com", "Claude"), grant("a@x.com", "ChatGPT")],
      [],
    );

    expect(summaries.get("a@x.com")).toEqual({
      connections: 2,
      apps: [
        { name: "ChatGPT", count: 1 },
        { name: "Claude", count: 1 },
      ],
      manualClients: 0,
    });
  });

  it("keeps accounts apart", () => {
    // The whole point of the map. One account's approvals appearing under
    // another's row would be a privacy claim about the wrong person.
    const summaries = summarizeConnectors(
      [grant("a@x.com", "Claude"), grant("b@x.com", "ChatGPT")],
      [],
    );

    expect(summaries.get("a@x.com")?.connections).toBe(1);
    expect(summaries.get("b@x.com")?.apps).toEqual([{ name: "ChatGPT", count: 1 }]);
  });

  it("counts repeat approvals of one app once by name, twice by connection", () => {
    // Two laptops on Claude is two live credentials and one name. Reporting one
    // connection would understate what can reach the data; repeating the chip
    // would read as a rendering bug.
    const summaries = summarizeConnectors(
      [grant("a@x.com", "Claude"), grant("a@x.com", "Claude")],
      [],
    );

    expect(summaries.get("a@x.com")).toEqual({
      connections: 2,
      apps: [{ name: "Claude", count: 2 }],
      manualClients: 0,
    });
  });

  it("orders apps busiest first, then alphabetically", () => {
    // Row order out of the query is not stable, and a chip row that reshuffles
    // between two loads of the same screen invites the reader to believe
    // something changed.
    const summaries = summarizeConnectors(
      [
        grant("a@x.com", "Zed"),
        grant("a@x.com", "Claude"),
        grant("a@x.com", "Claude"),
        grant("a@x.com", "ChatGPT"),
      ],
      [],
    );

    expect(summaries.get("a@x.com")?.apps.map((app) => app.name)).toEqual([
      "Claude",
      "ChatGPT",
      "Zed",
    ]);
  });

  it("matches addresses case- and whitespace-insensitively", () => {
    const summaries = summarizeConnectors(
      [grant(" A@X.com ", "Claude"), grant("a@x.com", "ChatGPT")],
      [{ createdBy: "A@x.COM" }],
    );

    expect(summaries.size).toBe(1);
    expect(summaries.get("a@x.com")).toEqual({
      connections: 2,
      apps: [
        { name: "ChatGPT", count: 1 },
        { name: "Claude", count: 1 },
      ],
      manualClients: 1,
    });
  });

  it("credits a hand-made connector to its author without inventing a grant", () => {
    // The distinction the module exists for: registering a client for somebody
    // else is not the author connecting anything.
    const summaries = summarizeConnectors([], [{ createdBy: "a@x.com" }]);

    expect(summaries.get("a@x.com")).toEqual({
      connections: 0,
      apps: [],
      manualClients: 1,
    });
  });

  it("ignores self-registered clients, which have no author", () => {
    const summaries = summarizeConnectors([], [{ createdBy: null }]);

    expect(summaries.size).toBe(0);
  });

  it("names a blank client rather than rendering an empty chip", () => {
    const summaries = summarizeConnectors([grant("a@x.com", "  ")], []);

    expect(summaries.get("a@x.com")?.apps).toEqual([
      { name: "Unnamed connector", count: 1 },
    ]);
  });
});

describe("connectorsFor", () => {
  it("reports nothing connected for an account with no rows", () => {
    expect(connectorsFor(new Map(), "nobody@x.com")).toEqual(NO_CONNECTORS);
  });

  it("looks up regardless of the case the row stores", () => {
    const summaries = summarizeConnectors([grant("a@x.com", "Claude")], []);

    expect(connectorsFor(summaries, "A@X.com")?.connections).toBe(1);
  });

  it("distinguishes a failed read from an empty one", () => {
    // `null` means the database could not be asked. Rendering that as zero
    // would be a confident claim built out of an outage.
    expect(connectorsFor(null, "a@x.com")).toBeNull();
  });

  it("hands out a summary nobody can mutate for the next row", () => {
    const empty = connectorsFor(new Map(), "a@x.com");

    expect(Object.isFrozen(empty)).toBe(true);
    expect(Object.isFrozen(empty?.apps)).toBe(true);
  });
});
