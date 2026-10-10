/**
 * HallPass — the payload a game attaches to an invite.
 *
 * PURE. Used by the route (the authority), the picker page (to refuse a payload
 * before offering to send it) and the tests.
 *
 * HALLPASS NEVER INTERPRETS IT. LAST BELL sends `{ room: "ABCD" }`; another game
 * may send a level and a seed. The only rules are the ones that keep it cheap
 * and inert to store and hand back: a JSON OBJECT (never an array or a bare
 * value, so a game can always add a field later), at most
 * {@link MAX_INVITE_DATA_BYTES} once serialised.
 *
 * Measured in UTF-8 BYTES, not string length: the column, the URL the picker is
 * opened with and the request body all carry bytes, and a payload of emoji is
 * four bytes a character.
 */

/** The ceiling on `JSON.stringify(data)`, in UTF-8 bytes. Mirrored in the SDK. */
export const MAX_INVITE_DATA_BYTES = 1024;

/** UTF-8 byte length without `Buffer`, so this runs in a browser too. */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** A plain `{}` object — not an array, not `null`, not a class instance. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * The data as a validated object plus its canonical serialisation, or `null`.
 *
 * Round-trips through JSON so what is stored is exactly what will be handed
 * back: a `Date` becomes a string here rather than in somebody else's game,
 * `undefined` fields disappear here rather than later, and a value JSON cannot
 * represent (a cycle, a `BigInt`) is refused here rather than half-stored.
 */
export function parseInviteData(
  value: unknown,
): { data: Record<string, unknown>; json: string } | null {
  if (!isPlainObject(value)) return null;
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return null;
  }
  if (typeof json !== "string" || utf8Bytes(json) > MAX_INVITE_DATA_BYTES) return null;
  const data = JSON.parse(json) as unknown;
  return isPlainObject(data) ? { data, json } : null;
}

/**
 * Parse the `data` query parameter the picker is opened with (a JSON string),
 * or `null` when it is missing, not JSON, or fails {@link parseInviteData}.
 */
export function parseInviteDataParam(
  raw: unknown,
): { data: Record<string, unknown>; json: string } | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  // A quick ceiling before parsing: no valid payload is longer than this many
  // UTF-16 units, since every unit is at least one UTF-8 byte.
  if (raw.length > MAX_INVITE_DATA_BYTES) return null;
  try {
    return parseInviteData(JSON.parse(raw));
  } catch {
    return null;
  }
}
