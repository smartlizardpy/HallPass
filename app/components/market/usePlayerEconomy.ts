"use client";

/**
 * The signed-in player's Hall Tokens wallet and the two market actions, in the
 * browser (the Market page is static; per-player data can only arrive from
 * `/api/`). `buy` mints a fresh request id per call, so a double tap buys once.
 * After each action the wallet reloads, and `reloadBinder` is called so a sold
 * card leaves the binder the page is showing.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { MyTokens } from "@/app/lib/hall-tokens";

export type EconomyState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "unavailable" }
  | { status: "ready"; data: MyTokens };

export type ActionResult = { ok: true; balance: number; packId?: string; credited?: number } | { ok: false; error: string };

async function fetchWallet(): Promise<EconomyState> {
  try {
    const r = await fetch("/api/v1/market/me", { credentials: "include", cache: "no-store" });
    if (r.status === 401) return { status: "signedOut" };
    if (!r.ok) return { status: "unavailable" };
    const data = (await r.json()) as MyTokens;
    return data.available ? { status: "ready", data } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

async function post(path: string, body: Record<string, unknown>): Promise<Response | null> {
  try {
    return await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

export function usePlayerEconomy(reloadBinder?: () => void | Promise<void>) {
  const [state, setState] = useState<EconomyState>({ status: "loading" });
  const active = useRef(true);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const ticket = ++latest.current;
    const next = await fetchWallet();
    if (active.current && ticket === latest.current) setState(next);
  }, []);

  useEffect(() => {
    active.current = true;
    void reload();
    return () => {
      active.current = false;
    };
  }, [reload]);

  const buy = useCallback(
    async (packId: string): Promise<ActionResult> => {
      const res = await post("/api/v1/market/buy-pack", { packId, requestId: crypto.randomUUID() });
      if (!res) return { ok: false, error: "Network problem. Nothing was spent." };
      const body = (await res.json().catch(() => ({}))) as { error?: string; balance?: number; pack?: { id: string } };
      await reload();
      if (!res.ok) return { ok: false, error: body.error ?? "Could not buy that pack." };
      await reloadBinder?.();
      return { ok: true, balance: body.balance ?? 0, packId: body.pack?.id };
    },
    [reload, reloadBinder],
  );

  const sell = useCallback(
    async (collectibleId: string): Promise<ActionResult> => {
      const res = await post("/api/v1/market/sell", { collectibleId });
      if (!res) return { ok: false, error: "Network problem. Nothing was sold." };
      const body = (await res.json().catch(() => ({}))) as { error?: string; balance?: number; credited?: number };
      await reload();
      if (!res.ok) return { ok: false, error: body.error ?? "Could not sell that card." };
      await reloadBinder?.();
      return { ok: true, balance: body.balance ?? 0, credited: body.credited };
    },
    [reload, reloadBinder],
  );

  return { state, reload, buy, sell };
}
