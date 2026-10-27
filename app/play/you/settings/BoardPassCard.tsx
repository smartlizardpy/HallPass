"use client";

import { useState, useTransition } from "react";
import { PinPad } from "@/app/components/boardpass/PinPad";
import { copy } from "@/app/lib/boardpass/copy";
import {
  disableBoardPass,
  reauthForBoardPass,
  saveBoardPassPin,
  signOutAllBoards,
  type BoardPassActionResult,
} from "@/app/play/account/boardpass-actions";

type Step = "idle" | "choose" | "confirm" | "done";

const ERRORS: Record<string, string> = {
  mismatch: copy.pinMismatch,
  "weak-pin": copy.pinWeak,
  "invalid-pin": copy.pinInvalid,
  "no-username": copy.pickUsernameFirst,
  unavailable: copy.unavailable,
  failed: copy.saveFailed,
  "signed-out": copy.saveFailed,
};

export function BoardPassCard({
  enabled,
  username,
  boards,
  recent,
}: {
  enabled: boolean;
  username: string | null;
  boards: number;
  /** A Google sign-in within the last 10 minutes. */
  recent: boolean;
}) {
  const [step, setStep] = useState<Step>("idle");
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(!recent);
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();

  function handle(r: BoardPassActionResult, onOk: () => void) {
    if (r.ok) return onOk();
    if (r.error === "reauth") {
      setNeedsReauth(true);
      setStep("idle");
      return;
    }
    setMessage(ERRORS[r.error] ?? copy.saveFailed);
    if (r.error === "mismatch" || r.error === "weak-pin") {
      setFirst("");
      setSecond("");
      setStep("choose");
    }
  }

  function save(confirm: string) {
    setMessage(null);
    start(async () => {
      const r = await saveBoardPassPin(first, confirm);
      setFirst("");
      setSecond("");
      handle(r, () => {
        setOn(true);
        setStep("done");
      });
    });
  }

  const card = "rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5 space-y-4";
  const btn = "rounded-lg px-4 py-2 text-sm font-medium border border-black/10 dark:border-white/15 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50";
  const primary = "rounded-lg px-4 py-2 text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50";

  return (
    <div className={card}>
      <div>
        <h3 className="font-semibold">{copy.settingsTitle}</h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{copy.settingsBlurb}</p>
      </div>

      {!username ? (
        <p className="text-sm">{copy.pickUsernameFirst}</p>
      ) : needsReauth ? (
        <form action={reauthForBoardPass} className="space-y-2">
          <p className="text-sm">{copy.confirmItsYouBody}</p>
          <button className={primary}>{copy.confirmItsYou}</button>
        </form>
      ) : step === "choose" || step === "confirm" ? (
        <div className="mx-auto max-w-xs space-y-2">
          <p className="text-center text-sm font-medium">
            {step === "choose" ? copy.newPin : copy.confirmPin}
          </p>
          {step === "choose" ? (
            <PinPad value={first} onChange={setFirst} onComplete={() => setStep("confirm")} label={copy.newPin} />
          ) : (
            <PinPad value={second} onChange={setSecond} onComplete={save} disabled={pending} label={copy.confirmPin} />
          )}
          <p className="text-center text-xs text-neutral-500">{copy.pinHint}</p>
          <button type="button" className={btn} onClick={() => { setFirst(""); setSecond(""); setStep("idle"); }}>
            {copy.cancel}
          </button>
        </div>
      ) : step === "done" ? (
        <div className="space-y-1">
          <p className="font-medium">{copy.readyTitle}</p>
          <p className="text-sm">{copy.readyBody}</p>
          <p className="text-sm">{copy.yourUsername}: <b>@{username}</b></p>
          <button className={btn} onClick={() => setStep("idle")}>OK</button>
        </div>
      ) : on ? (
        <div className="space-y-3">
          <p className="text-sm"><b>{copy.enabled}</b> · {copy.yourUsername}: @{username}</p>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">{copy.signedInOnBoards(boards)}</p>
          <div className="flex flex-wrap gap-2">
            <button className={btn} onClick={() => { setMessage(null); setStep("choose"); }}>{copy.changePin}</button>
            <button className={btn} disabled={pending} onClick={() => start(async () => handle(await signOutAllBoards(), () => setMessage(copy.signedOutBoards)))}>
              {copy.signOutBoards}
            </button>
            <button className={btn} disabled={pending} onClick={() => {
              if (!window.confirm(copy.disableConfirm)) return;
              start(async () => handle(await disableBoardPass(), () => setOn(false)));
            }}>{copy.disable}</button>
          </div>
        </div>
      ) : (
        <button className={primary} onClick={() => { setMessage(null); setStep("choose"); }}>{copy.createPin}</button>
      )}

      {message && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{message}</p>}
    </div>
  );
}
