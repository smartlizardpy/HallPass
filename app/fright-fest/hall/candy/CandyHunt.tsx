"use client";

/**
 * The Candy Hunt section of /fright-fest (`#candy`): the rules, the earn table
 * and the shop are in the prerendered HTML, from props the server built
 * (props.ts). The page stays STATIC: the balance, the recent list and the Buy
 * buttons come alive from one client fetch of `/api/v1/candy/me` after hydration.
 *
 * Buying is an inline confirm inside the item (no modal). A `requestId` is
 * minted when the confirm opens and reused for every retry of THAT purchase, so
 * a dropped response can never buy twice; a new confirm gets a new id. The
 * words for every response are in logic.ts (`spendMessage`).
 *
 * Drawn as the arcade's corkboard (sections.css, `.ar-*`; candy.css for the shelf):
 * pinned paper notices and a prize-counter shelf. Fixed palette, no base tokens.
 * Only the markup and its classes changed from the plain-card version; every
 * behaviour, state, label and accessibility feature is the same.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { startSignIn } from "@/app/lib/auth-actions";
import { useMinute } from "@/app/components/championship/data";
import { buttonState, candyPhase, spendMessage, type SpendBody, type SpendMessage } from "./logic";
import type { CandyProps, ShelfItemProps } from "./props";
import "./candy.css";

/** The parts of `GET /api/v1/candy/me` this section reads. */
interface RecentRow {
  label: string;
  game: string | null;
  amount: number;
  at: string;
  revoked: boolean;
}
interface Me {
  signedIn: boolean;
  available?: boolean;
  balance?: number;
  newlyCredited?: { count: number; amount: number };
  recent?: RecentRow[];
  earn: { open: boolean };
  spend: { open: boolean };
}
type Load = { status: "loading" } | { status: "error" } | { status: "ok"; me: Me };

const RECENT_SHOWN = 5;
const PRIMARY = "ar-btn ar-btn-gold";
const QUIET = "ar-btn";

function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function SignInForm({ label }: { label: string }) {
  return (
    <form action={startSignIn}>
      <button type="submit" className="ar-btn ar-btn-gold">
        {label}
      </button>
    </form>
  );
}

export function CandyHunt({ candy }: { candy: CandyProps }) {
  const { labels } = candy;
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [announce, setAnnounce] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [confirm, setConfirm] = useState<{ packId: string; requestId: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ packId: string; msg: SpendMessage } | null>(null);
  const buyRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const confirmBtn = useRef<HTMLButtonElement | null>(null);
  const outcomeRef = useRef<HTMLDivElement | null>(null);
  const now = useMinute();

  const fetchMe = useCallback(async (quiet: boolean) => {
    try {
      const res = await fetch("/api/v1/candy/me", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      const me = (await res.json()) as Me;
      setLoad((prev) => (quiet && prev.status === "ok" ? { status: "ok", me: { ...me, newlyCredited: prev.me.newlyCredited } } : { status: "ok", me }));
      if (!quiet && me.signedIn && me.available && (me.newlyCredited?.count ?? 0) > 0) {
        setAnnounce(`You earned ${me.newlyCredited?.amount ?? 0} new candy.`);
      }
    } catch {
      if (!quiet) setLoad({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void fetchMe(false);
  }, [fetchMe]);

  const me = load.status === "ok" ? load.me : null;
  const live = me?.signedIn === true && me.available === true;
  const balance = live ? (me.balance ?? 0) : 0;
  const phase = candyPhase(now, candy.dates, me ? { earnOpen: me.earn.open, spendOpen: me.spend.open } : null);

  // Focus follows the confirm: into it on open, and back out to its Buy button on close.
  const confirmedPack = confirm?.packId ?? null;
  useEffect(() => {
    if (confirmedPack) confirmBtn.current?.focus();
  }, [confirmedPack]);
  useEffect(() => {
    if (outcome && !outcome.msg.retry) outcomeRef.current?.focus();
  }, [outcome]);

  function closeConfirm(packId: string) {
    setConfirm(null);
    setOutcome((o) => (o?.packId === packId && o.msg.retry ? null : o));
    requestAnimationFrame(() => buyRefs.current.get(packId)?.focus());
  }

  function openConfirm(item: ShelfItemProps) {
    setOutcome(null);
    setConfirm({ packId: item.packId, requestId: newRequestId() });
  }

  async function buy(item: ShelfItemProps) {
    if (!confirm || confirm.packId !== item.packId || busy) return;
    setBusy(item.packId);
    let status = 0;
    let body: SpendBody | null = null;
    try {
      const res = await fetch("/api/v1/candy/spend", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId: item.packId, requestId: confirm.requestId }),
      });
      status = res.status;
      body = (await res.json().catch(() => null)) as SpendBody | null;
    } catch {
      status = 0;
    }
    const msg = spendMessage(status, body, { price: item.price, balance });
    setBusy(null);
    if (msg.balance !== null) {
      const next = msg.balance;
      setLoad((prev) => (prev.status === "ok" ? { status: "ok", me: { ...prev.me, balance: next } } : prev));
    }
    setOutcome({ packId: item.packId, msg });
    setAnnounce(msg.text);
    if (!msg.retry) setConfirm(null);
    if (msg.sealed) void fetchMe(true);
  }

  const recent = me?.recent ?? [];
  const rows = showAll ? recent : recent.slice(0, RECENT_SHOWN);

  return (
    <section id="candy" aria-labelledby="candy-h" className="ar-sec ar-corkboard scroll-mt-24">
      <div className="ar-cork">
        <div className="ar-head">
          <h2 id="candy-h">Candy Hunt</h2>
        </div>
        <p className="ar-lede">
          Earn Halloween Candy by playing from {labels.opens} to {labels.earnEnds}. Spend it on packs until {labels.spendUntil}. Unspent
          candy melts after that.
        </p>
        <p role="status" className="sr-only">
          {announce}
        </p>

        {/* Your candy */}
        <div aria-labelledby="candy-mine-h" className="ar-notice ar-ticket-card">
          <h3 id="candy-mine-h" className="ar-ntitle">
            Your candy
          </h3>
          {load.status === "loading" ? (
            <div className="ar-paper-skel" aria-hidden="true" />
          ) : load.status === "error" ? (
            <div className="ar-mine-row">
              <p>Your candy could not be loaded.</p>
              <button
                type="button"
                className={QUIET}
                onClick={() => {
                  setLoad({ status: "loading" });
                  void fetchMe(false);
                }}
              >
                Try again
              </button>
            </div>
          ) : !load.me.signedIn ? (
            <div className="ar-mine-row">
              <p>
                <b>Sign in to collect candy.</b> Guests can play, but only signed-in players earn it.
              </p>
              <SignInForm label="Sign in to collect candy" />
            </div>
          ) : !load.me.available ? (
            <p>Candy is not available right now. Your candy is safe; check back soon.</p>
          ) : (
            <div>
              <p className="ar-balance">
                <span className="ar-big" data-testid="candy-balance">
                  {balance}
                </span>
                <span className="ar-unit">candy</span>
                {(load.me.newlyCredited?.count ?? 0) > 0 && <span className="ar-new">+{load.me.newlyCredited?.amount} new</span>}
              </p>
              {balance < 0 && <p className="ar-strong-line">Spending is paused until your balance is above 0.</p>}
              <h4 className="ar-nsub">Recent</h4>
              {recent.length === 0 ? (
                <p>Nothing yet. Play a game from {labels.opens} and your candy lands here.</p>
              ) : (
                <>
                  <ul className="ar-rows">
                    {rows.map((r, i) => (
                      <li key={`${r.at}-${i}`}>
                        <span className="min-w-0">
                          <span className={r.revoked ? "ar-revoked" : ""}>{r.label}</span>
                          {r.game && <span className="ar-faint"> · {r.game}</span>}
                          {r.revoked && <span className="ar-faint ar-tag"> revoked</span>}
                        </span>
                        <b className={r.revoked ? "ar-revoked" : ""}>{r.amount > 0 ? `+${r.amount}` : r.amount}</b>
                      </li>
                    ))}
                  </ul>
                  {recent.length > RECENT_SHOWN && (
                    <button type="button" className={`${QUIET} mt-2`} aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
                      {showAll ? "Show fewer" : `Show all (${recent.length})`}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* How to earn */}
        <h3 className="ar-sub ar-sub-cork">How to earn</h3>
        <div className="ar-notes">
          <div className="ar-notice">
            <h4 className="ar-ntitle">Achievements</h4>
            <ul className="ar-rows">
              {candy.rubric.map((t) => (
                <li key={t.label}>
                  <span>{t.label}</span>
                  <b>{t.value}</b>
                </li>
              ))}
            </ul>
            <p className="ar-nfoot">
              Each game&apos;s achievements have their own value. Unlocks count from {labels.opens} to {labels.earnEnds}.
            </p>
          </div>
          <div className="ar-notice">
            <h4 className="ar-ntitle">Fright Fest ranked runs</h4>
            <p className="ar-rows ar-row-p">
              <span>Your first ranked run on each board</span>
              <b>{candy.rankedRun}</b>
            </p>
          </div>
          <div className="ar-notice">
            <h4 className="ar-ntitle">Final results</h4>
            <p className="ar-nfoot ar-nfoot-top">Paid once the results are final, by {labels.resultsBy}.</p>
            <ul className="ar-rows">
              {candy.placing.map((p) => (
                <li key={p.label}>
                  <span>{p.label} on each board</span>
                  <b>{p.amount}</b>
                </li>
              ))}
              <li>
                <span>A result on every board</span>
                <b>+{candy.allBoards}</b>
              </li>
            </ul>
          </div>
        </div>

        {/* The shop */}
        <div id="candy-shop">
          <h3 className="ar-sub ar-sub-cork">The Candy Shop</h3>
          {candy.shelves.map((shelf) => (
            <div key={shelf.price} className="ar-shelf-wrap">
              <h4 className="ar-shelf-label">{shelf.price} candy</h4>
              <ul className="cd-shelf">
                {shelf.items.map((item) => (
                  <ShopItem
                    key={item.packId}
                    item={item}
                    state={buttonState(
                      item.price,
                      {
                        signedIn: live,
                        phase,
                        balance,
                        busy: busy === item.packId,
                      },
                      labels,
                    )}
                    gate={load.status === "ok" ? (live ? "ready" : me?.signedIn ? "unavailable" : "signed-out") : load.status === "error" ? "unavailable" : "loading"}
                    busy={busy !== null}
                    confirming={confirm?.packId === item.packId}
                    retry={outcome?.packId === item.packId && outcome.msg.retry ? outcome.msg : null}
                    outcome={outcome?.packId === item.packId && !outcome.msg.retry ? outcome.msg : null}
                    outcomeRef={outcomeRef}
                    confirmBtn={confirmBtn}
                    setBuyRef={(el) => buyRefs.current.set(item.packId, el)}
                    onOpen={() => openConfirm(item)}
                    onCancel={() => closeConfirm(item.packId)}
                    onBuy={() => void buy(item)}
                  />
                ))}
              </ul>
            </div>
          ))}
          <p className="ar-cork-line">
            <Link href="/packs#pack-odds" className="ar-link">
              What&apos;s in each pack
            </Link>
          </p>
          <p className="ar-cork-line">Bought packs arrive sealed in your Pack Room.</p>
        </div>

        {/* The rules */}
        <div className="ar-notice ar-rules-note">
          <h3 className="ar-ntitle">The rules</h3>
          <ul className="ar-rules">
            <li>Candy is earned only by playing.</li>
            <li>It is never sold and has no cash value.</li>
            <li>It can&apos;t be traded or gifted.</li>
            <li>It is spent only on packs, at the published odds.</li>
            <li>It expires on {labels.spendUntil}.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

type Gate = "loading" | "signed-out" | "unavailable" | "ready";

function ShopItem({
  item,
  state,
  gate,
  busy,
  confirming,
  retry,
  outcome,
  outcomeRef,
  confirmBtn,
  setBuyRef,
  onOpen,
  onCancel,
  onBuy,
}: {
  item: ShelfItemProps;
  state: ReturnType<typeof buttonState>;
  gate: Gate;
  busy: boolean;
  confirming: boolean;
  retry: SpendMessage | null;
  outcome: SpendMessage | null;
  outcomeRef: React.RefObject<HTMLDivElement | null>;
  confirmBtn: React.RefObject<HTMLButtonElement | null>;
  setBuyRef: (el: HTMLButtonElement | null) => void;
  onOpen: () => void;
  onCancel: () => void;
  onBuy: () => void;
}) {
  const inFlight = state.label === "Buying…";
  // Before the answer, and when there is no candy to read, the button says so rather than "Sign in".
  const label = gate === "loading" ? "Buy" : gate === "unavailable" ? "Unavailable" : state.label;
  const disabled = gate !== "ready" && gate !== "signed-out" ? true : state.disabled || (busy && !inFlight);
  return (
    <li className="cd-item">
      <div className="cd-stand">
        {/* eslint-disable-next-line @next/next/no-img-element -- a pixel print; next/image would smooth it */}
        <img src={item.print} alt="" width={72} height={105} loading="lazy" className="hl-print cd-print" />
      </div>
      <div className="cd-tag">
        <b>{item.name}</b>
        <span className="cd-price">{item.price} candy</span>
      </div>
      {confirming ? (
        <div
          role="group"
          aria-label={`Confirm: ${item.name}`}
          className="cd-plate"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              onCancel();
            }
          }}
        >
          <p>
            Spend {item.price} candy on the {item.name}?
          </p>
          {retry && (
            <p role="alert" className="cd-alert">
              {retry.text}
            </p>
          )}
          <div className="cd-plate-btns">
            <button ref={confirmBtn} type="button" className={PRIMARY} disabled={busy} onClick={onBuy}>
              {busy ? "Buying…" : retry ? "Try again" : "Buy it"}
            </button>
            <button type="button" className={QUIET} disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {outcome && (
            <div ref={outcomeRef} tabIndex={-1} className="cd-plate">
              <p className="cd-alert">{outcome.text}</p>
              {outcome.sealed && (
                <Link href="/packs" className="ar-link">
                  Open your Pack Room
                </Link>
              )}
              {outcome.tone === "signin" && (
                <div className="mt-1 flex justify-center">
                  <SignInForm label="Sign in" />
                </div>
              )}
            </div>
          )}
          <button
            ref={setBuyRef}
            type="button"
            className={`${PRIMARY} cd-buy`}
            disabled={disabled}
            aria-label={disabled ? undefined : `Buy the ${item.name} for ${item.price} candy`}
            onClick={onOpen}
          >
            {label}
          </button>
          {state.reason && gate === "ready" && <span className="cd-reason">{state.reason}</span>}
        </>
      )}
    </li>
  );
}
