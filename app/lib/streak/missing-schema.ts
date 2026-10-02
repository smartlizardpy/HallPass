/**
 * HallPass — which table was missing, for the reminder endpoint's 503 (pure).
 *
 * The "who is due" query reads TWO tables from two different migrations:
 * `player_streaks` (036) and `push_subscriptions` (023). A 503 that said only
 * "apply migration 036" would send an operator whose real problem was 023 on a
 * wasted trip, so the message names whichever table Postgres complained about —
 * and both, when the error does not say.
 */

/** The tables the reminder query needs, and the migration that creates each. */
export const REMINDER_TABLES = {
  player_streaks: "036_player_streaks.sql",
  push_subscriptions: "023_push_subscriptions.sql",
} as const;

type ReminderTable = keyof typeof REMINDER_TABLES;

/**
 * The reminder table a Postgres "relation ... does not exist" error names, or
 * `null` when the error does not name one of ours (a wrapped error, a missing
 * column, an unconfigured database).
 */
export function missingReminderTable(error: unknown): ReminderTable | null {
  const message = error instanceof Error ? error.message : "";
  const match = /relation "?(?:public\.)?([a-z_]+)"? does not exist/i.exec(message);
  const name = match?.[1]?.toLowerCase();
  return name && name in REMINDER_TABLES ? (name as ReminderTable) : null;
}

/** The 503 text: names the table when it can be told, otherwise both. */
export function missingSchemaMessage(error: unknown): string {
  const table = missingReminderTable(error);
  if (table) {
    return `${table} is not available. Apply migration ${REMINDER_TABLES[table]}.`;
  }
  return (
    "A table the reminder needs is not available — either player_streaks " +
    `(apply migration ${REMINDER_TABLES.player_streaks}) or push_subscriptions ` +
    `(apply migration ${REMINDER_TABLES.push_subscriptions}).`
  );
}
