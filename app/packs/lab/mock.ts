"use client";

/**
 * DEV-ONLY. A fake signed-in player for the pack-opening lab (`/packs/lab`),
 * installed by patching `window.fetch` for `/api/v1/collection*` only. The page
 * that imports this 404s in production builds (see `page.tsx`).
 *
 * State lives in sessionStorage, so a reload keeps what was opened: that is how
 * the lab exercises "refresh during the reveal". `?reset=1` starts over.
 * Scenario switches (query string): `slow=<ms>` delays the open call,
 * `fail=<n>` makes the first n open calls answer 503, `state=signedout`.
 */

import { CATALOGUE } from "@/app/lib/collectibles/catalogue";

type Entry = { collectibleId: string; owned: number; firstPulledAt: string; favourite: boolean; featuredPosition: number | null; isNew: boolean };
type Pull = { slot: number; collectibleId: string; wasNew: boolean };
type LabState = { binder: Record<string, Entry>; opened: Record<string, { at: string; pulls: Pull[] }>; fails: number };

const pick = (col: string, rarity: string, n = 0) => CATALOGUE.collectibles.filter((c) => c.collection === col && c.rarity === rarity && c.pool === "standard")[n]?.id ?? "";

/** One demo pack per print, with contents chosen to show every rarity at least once. */
export const LAB_PACKS = [
  { publicId: "11111111-2222-4333-8444-555555555501", packId: "ff26-participation", contents: ["ff26-survivor", "ff26-cobweb-bell", "ff26-the-last-bell"] },
  { publicId: "11111111-2222-4333-8444-555555555502", packId: "ff26-overall-winner", contents: ["ff26-overall-champion", "ff26-the-last-bell", "ff26-blood-moon"] },
  { publicId: "11111111-2222-4333-8444-555555555503", packId: "hpo-standard", contents: [pick("hpo", "common", 2), pick("hpo", "uncommon", 1), pick("hpo", "epic", 0)] },
  { publicId: "11111111-2222-4333-8444-555555555504", packId: "inet-standard", contents: [pick("inet", "common", 0), pick("inet", "common", 1), pick("inet", "rare", 0)] },
  { publicId: "11111111-2222-4333-8444-555555555505", packId: "brr-standard", contents: [pick("brr", "uncommon", 0), pick("brr", "common", 1), pick("brr", "rare", 0)] },
  { publicId: "11111111-2222-4333-8444-555555555506", packId: "tr-standard", contents: [pick("tr", "common", 0), pick("tr", "uncommon", 0), pick("tr", "legendary", 0)] },
];

const KEY = "hp:packs-lab";
const day = (d: number) => new Date(Date.UTC(2026, 9, d, 16)).toISOString();

function seed(): LabState {
  const binder: Record<string, Entry> = {};
  const own = (id: string, owned = 1, extra: Partial<Entry> = {}) => {
    if (id) binder[id] = { collectibleId: id, owned, firstPulledAt: day(20), favourite: false, featuredPosition: null, isNew: false, ...extra };
  };
  for (const [id, n] of [["ff26-cobweb-bell", 3], ["ff26-room-000", 1], ["ff26-shadow-dash", 2], ["ff26-pumpkin-locker", 1], ["ff26-arcade-bat", 2]] as const) own(id, n);
  own("ff26-yellow-moon", 1, { favourite: true, featuredPosition: 1 });
  own(pick("hpo", "common", 0), 2);
  own(pick("hpo", "uncommon", 1), 1);
  own(pick("inet", "common", 0), 1);
  own(pick("brr", "uncommon", 0), 1);
  return { binder, opened: {}, fails: 0 };
}

export function installLabApi(): void {
  const w = window as unknown as { __hpLab?: boolean };
  if (w.__hpLab) return;
  w.__hpLab = true;

  const q = new URLSearchParams(window.location.search);
  const signedOut = q.get("state") === "signedout";
  const slow = Math.max(0, Number(q.get("slow") ?? 0) || 0);
  const load = (): LabState => {
    try {
      if (q.get("reset") === "1") sessionStorage.removeItem(KEY);
      const raw = sessionStorage.getItem(KEY);
      if (raw) return JSON.parse(raw) as LabState;
    } catch {
      // fall through to a fresh player
    }
    return { ...seed(), fails: Math.max(0, Number(q.get("fail") ?? 0) || 0) };
  };
  const state = load();
  const save = () => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // the lab still works for this page view
    }
  };
  save();

  const progress = () =>
    CATALOGUE.collections.map((c) => {
      const total = CATALOGUE.collectibles.filter((x) => x.collection === c.id).length;
      const owned = Object.keys(state.binder).filter((id) => CATALOGUE.collectibles.find((x) => x.id === id)?.collection === c.id).length;
      return { collection: c.id, owned, total, percent: total ? Math.floor((owned / total) * 100) : 0 };
    });
  const packRow = (p: (typeof LAB_PACKS)[number]) => ({
    publicId: p.publicId,
    packId: p.packId,
    packVersion: 1,
    source: "championship",
    grantedAt: day(25),
    openedAt: state.opened[p.publicId]?.at ?? null,
    revokedAt: null,
  });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const real = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, window.location.href).pathname;
    if (!path.startsWith("/api/v1/collection")) return real(input, init);
    await new Promise((r) => setTimeout(r, 200));
    if (signedOut) return json({ error: "Sign in required" }, 401);

    if (path === "/api/v1/collection") {
      return json({
        available: true,
        sealed: LAB_PACKS.filter((p) => !state.opened[p.publicId]).map(packRow),
        recent: LAB_PACKS.filter((p) => state.opened[p.publicId]).map((p) => ({ pack: packRow(p), pulls: state.opened[p.publicId].pulls })),
        binder: Object.values(state.binder),
        progress: progress(),
      });
    }
    const m = path.match(/^\/api\/v1\/collection\/packs\/([^/]+)\/open$/);
    if (m) {
      if (slow) await new Promise((r) => setTimeout(r, slow));
      if (state.fails > 0) {
        state.fails--;
        save();
        return json({ error: "Opening is temporarily unavailable. Nothing was lost: try again." }, 503);
      }
      const p = LAB_PACKS.find((x) => x.publicId === m[1]);
      if (!p) return json({ error: "No such pack" }, 404);
      const already = state.opened[p.publicId];
      if (!already) {
        const seen = new Set<string>();
        const pulls = p.contents.map((id, i) => {
          const had = state.binder[id] || seen.has(id);
          seen.add(id);
          if (state.binder[id]) state.binder[id].owned++;
          else state.binder[id] = { collectibleId: id, owned: 1, firstPulledAt: new Date().toISOString(), favourite: false, featuredPosition: null, isNew: true };
          return { slot: i + 1, collectibleId: id, wasNew: !had };
        });
        state.opened[p.publicId] = { at: new Date().toISOString(), pulls };
        save();
      }
      const o = state.opened[p.publicId];
      return json({ alreadyOpened: !!already, pack: { id: p.publicId, packId: p.packId, packVersion: 1, openedAt: o.at }, pulls: o.pulls });
    }
    if (path === "/api/v1/collection/prefs") return json({ ok: true });
    return json({ error: "not mocked" }, 404);
  };
}
