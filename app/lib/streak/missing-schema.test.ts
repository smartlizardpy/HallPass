import { describe, expect, it } from "vitest";
import { missingReminderTable, missingSchemaMessage } from "./missing-schema";

const pg = (table: string) => new Error(`relation "${table}" does not exist`);

describe("missingReminderTable", () => {
  it("names player_streaks and push_subscriptions", () => {
    expect(missingReminderTable(pg("player_streaks"))).toBe("player_streaks");
    expect(missingReminderTable(pg("push_subscriptions"))).toBe("push_subscriptions");
  });

  it("tolerates a schema-qualified name", () => {
    expect(missingReminderTable(new Error('relation "public.player_streaks" does not exist'))).toBe(
      "player_streaks",
    );
  });

  it("is null for a table that is not ours, or an error that names none", () => {
    expect(missingReminderTable(pg("notifications"))).toBeNull();
    expect(missingReminderTable(new Error("DATABASE_URL is not set"))).toBeNull();
    expect(missingReminderTable({ code: "42P01" })).toBeNull();
    expect(missingReminderTable(null)).toBeNull();
  });
});

describe("missingSchemaMessage", () => {
  it("points at the migration for the table that is actually missing", () => {
    expect(missingSchemaMessage(pg("push_subscriptions"))).toBe(
      "push_subscriptions is not available. Apply migration 023_push_subscriptions.sql.",
    );
    expect(missingSchemaMessage(pg("player_streaks"))).toContain("036_player_streaks.sql");
  });

  it("names both tables when it cannot tell which", () => {
    const message = missingSchemaMessage({ code: "42P01" });
    expect(message).toContain("player_streaks");
    expect(message).toContain("push_subscriptions");
    expect(message).toContain("036_player_streaks.sql");
    expect(message).toContain("023_push_subscriptions.sql");
  });
});
