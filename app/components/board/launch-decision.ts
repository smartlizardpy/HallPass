/**
 * What tapping a game should do, given who is signed in. Pure so the three cases
 * (nobody, one player, several) are tested rather than inferred from the lobby.
 *
 * One player launches straight away; several get the "Who's playing?" sheet so
 * the BoardPass binding is made for the player the students actually chose;
 * nobody sends them to sign in first. Guest play is not offered — the lobby has
 * no guest path, and this does not invent one.
 */

export type LaunchPlan<T> =
  | { kind: "needs-player" }
  | { kind: "launch"; who: T }
  | { kind: "pick" };

export function planLaunch<T>(roster: readonly T[]): LaunchPlan<T> {
  if (roster.length === 0) return { kind: "needs-player" };
  if (roster.length === 1) return { kind: "launch", who: roster[0] };
  return { kind: "pick" };
}
