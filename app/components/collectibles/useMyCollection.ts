"use client";

/**
 * The signed-in player's collection, fetched from `/api/v1/collection` in the
 * browser. The pages that use it (`/collection`, `/packs`) are statically
 * prerendered, and a page that calls `auth()` is not (see `ChallengedHere`), so
 * per-player data can only arrive from `/api/`.
 *
 * `signedOut` is the 401; `unavailable` is the tables not being there yet or a
 * network failure. Neither is an error screen: the page says so in a sentence.
 *
 * `reload()` fetches again without going back to `loading`, so a page that is
 * already showing the collection (the Pack Room after an opening) updates in
 * place.
 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { MyCollection } from "@/app/lib/collectibles";

export type CollectionState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "unavailable" }
  | { status: "ready"; data: MyCollection };

async function fetchCollection(): Promise<CollectionState> {
  try {
    const r = await fetch("/api/v1/collection", { credentials: "include", cache: "no-store" });
    if (r.status === 401) return { status: "signedOut" };
    if (!r.ok) return { status: "unavailable" };
    const data = (await r.json()) as MyCollection;
    return data.available ? { status: "ready", data } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

export function useMyCollection(): [CollectionState, Dispatch<SetStateAction<CollectionState>>, () => Promise<void>] {
  const [state, setState] = useState<CollectionState>({ status: "loading" });
  const active = useRef(true);
  /** Only the newest request may set the state. */
  const latest = useRef(0);

  /** Fetches; the answer is used only if the page is still there and no newer request was made since. */
  const request = useCallback(() => {
    const ticket = ++latest.current;
    return fetchCollection().then((next) => (active.current && ticket === latest.current ? next : null));
  }, []);

  const load = useCallback(async () => {
    const next = await request();
    if (next) setState(next);
  }, [request]);

  useEffect(() => {
    active.current = true;
    request().then((next) => {
      if (next) setState(next);
    });
    return () => {
      active.current = false;
    };
  }, [request]);

  return [state, setState, load];
}
