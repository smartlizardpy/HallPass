"use client";

/**
 * The signed-in player's collection, fetched from `/api/v1/collection` in the
 * browser. The pages that use it (`/collection`, `/packs`) are statically
 * prerendered, and a page that calls `auth()` is not (see `ChallengedHere`), so
 * per-player data can only arrive from `/api/`.
 *
 * `signedOut` is the 401; `unavailable` is the tables not being there yet or a
 * network failure. Neither is an error screen: the page says so in a sentence.
 */

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { MyCollection } from "@/app/lib/collectibles";

export type CollectionState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "unavailable" }
  | { status: "ready"; data: MyCollection };

export function useMyCollection(): [CollectionState, Dispatch<SetStateAction<CollectionState>>] {
  const [state, setState] = useState<CollectionState>({ status: "loading" });
  useEffect(() => {
    let active = true;
    fetch("/api/v1/collection", { credentials: "include" })
      .then(async (r) => {
        if (r.status === 401) return { status: "signedOut" } as const;
        if (!r.ok) return { status: "unavailable" } as const;
        const data = (await r.json()) as MyCollection;
        return data.available ? ({ status: "ready", data } as const) : ({ status: "unavailable" } as const);
      })
      .catch(() => ({ status: "unavailable" }) as const)
      .then((next) => {
        if (active) setState(next);
      });
    return () => {
      active = false;
    };
  }, []);
  return [state, setState];
}
