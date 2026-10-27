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

import { CATALOGUE, currentVersion, getPack } from "@/app/lib/collectibles/catalogue";
import { collectionProgress } from "@/app/lib/collectibles/progress";

type Entry = { collectibleId: string; owned: number; firstPulledAt: string; favourite: boolean; featuredPosition: number | null; isNew: boolean };
type Pull = { slot: number; collectibleId: string; wasNew: boolean };
type LabState = { binder: Record<string, Entry>; opened: Record<string, { at: string; pulls: Pull[] }>; fails: number };

const pick = (col: string, rarity: string, n = 0) => CATALOGUE.collectibles.filter((c) => c.collection === col && c.rarity === rarity && c.pool === "standard")[n]?.id ?? "";

/** One demo pack per print, with contents chosen to show every rarity at least once. */
export const LAB_PACKS = [
  { publicId: "11111111-2222-4333-8444-555555555501", packId: "ff26-participation", contents: ["ff26-survivor", pick("ff26", "common", 0), pick("ff26", "rare", 0)] },
  { publicId: "11111111-2222-4333-8444-555555555502", packId: "ff26-overall-winner", contents: ["ff26-overall-champion", pick("ff26", "epic", 0), pick("ff26", "epic", 1)] },
  { publicId: "11111111-2222-4333-8444-555555555503", packId: "legends-standard", contents: [pick("legends", "common", 2), pick("legends", "uncommon", 1), pick("legends", "legendary", 0)] },
  { publicId: "11111111-2222-4333-8444-555555555504", packId: "brainrot-standard", contents: [pick("brainrot", "common", 0), pick("brainrot", "common", 1), pick("brainrot", "epic", 0)] },
  { publicId: "11111111-2222-4333-8444-555555555505", packId: "turkish-standard", contents: [pick("turkish", "uncommon", 0), pick("turkish", "common", 1), pick("turkish", "legendary", 0)] },
  { publicId: "11111111-2222-4333-8444-555555555506", packId: "gaming-rare", contents: [pick("gaming", "common", 0), pick("gaming", "rare", 0), pick("gaming", "epic", 0)] },
];

const KEY = "hp:packs-lab";
const day = (d: number) => new Date(Date.UTC(2026, 9, d, 16)).toISOString();

function seed(): LabState {
  const binder: Record<string, Entry> = {};
  const own = (id: string, owned = 1, extra: Partial<Entry> = {}) => {
    if (id) binder[id] = { collectibleId: id, owned, firstPulledAt: day(20), favourite: false, featuredPosition: null, isNew: false, ...extra };
  };
  for (const [id, n] of [["ff26-survivor", 1], [pick("ff26", "common", 0), 3], [pick("ff26", "uncommon", 1), 1], [pick("ff26", "rare", 0), 2]] as const) own(id, n);
  own(pick("ff26", "common", 1), 1, { favourite: true, featuredPosition: 1 });
  own(pick("legends", "common", 0), 2);
  own(pick("legends", "rare", 0), 1);
  own(pick("brainrot", "uncommon", 0), 1);
  own("hpo-hall-pass", 1); // a retired demo card: its owner still sees it
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

  const progress = () => collectionProgress(Object.keys(state.binder).map((collectibleId) => ({ collectibleId })));
  const packRow = (p: (typeof LAB_PACKS)[number]) => ({
    publicId: p.publicId,
    packId: p.packId,
    packVersion: currentVersion(getPack(p.packId)!).v,
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
