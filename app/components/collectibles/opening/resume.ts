/**
 * Where this device got to in a pack's reveal, so a refresh (or closing the tab)
 * part-way resumes it instead of dumping every card face up. Presentation only:
 * the cards are in the binder the moment the open call succeeds, whatever this
 * says. localStorage, one small record per opened pack, pruned after 30 days.
 */

const PREFIX = "hp:open:";
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/** An opened pack this device has no record of resumes face down only if it was opened this recently. */
export const RESUME_FRESH_MS = 24 * 60 * 60 * 1000;

export interface ResumeRecord {
  flipped: boolean[];
  done: boolean;
}

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readResume(publicId: string): ResumeRecord | null {
  try {
    const raw = store()?.getItem(PREFIX + publicId);
    if (!raw) return null;
    const r = JSON.parse(raw) as { f?: unknown; d?: unknown };
    if (!Array.isArray(r.f)) return null;
    return { flipped: r.f.map(Boolean), done: r.d === 1 };
  } catch {
    return null;
  }
}

export function writeResume(publicId: string, record: ResumeRecord, now = Date.now()): void {
  const s = store();
  if (!s) return;
  try {
    s.setItem(PREFIX + publicId, JSON.stringify({ f: record.flipped.map((x) => (x ? 1 : 0)), d: record.done ? 1 : 0, t: now }));
    for (let i = s.length - 1; i >= 0; i--) {
      const key = s.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const t = (JSON.parse(s.getItem(key) ?? "{}") as { t?: number }).t;
      if (typeof t !== "number" || now - t > KEEP_MS) s.removeItem(key);
    }
  } catch {
    // Storage full or blocked: the reveal still works, it just won't resume.
  }
}

/**
 * How to show a pack that was already open when the page loaded: resume the
 * reveal where this device left it, or (no record, opened long ago or on
 * another device) go straight to the summary.
 */
export function resumeFor(record: ResumeRecord | null, openedAt: string | null, count: number, now = Date.now()): { flipped: boolean[] | null; done: boolean } {
  if (record && record.flipped.length === count) return { flipped: record.flipped, done: record.done };
  const opened = openedAt ? Date.parse(openedAt) : Number.NaN;
  const fresh = Number.isFinite(opened) && now - opened < RESUME_FRESH_MS;
  return { flipped: null, done: !fresh };
}
