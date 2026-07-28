"use client";

import { useCallback, useEffect, useState } from "react";
import {
  USERNAME_REJECTION_MESSAGES,
  formatFriendCode,
  validateUsernameFormat,
} from "../../lib/username";

/**
 * Username + friend-code controls for the account page.
 *
 * A client island rather than a server form with a server action, because the
 * availability check wants to run as the user types. `/play/account` is already
 * dynamic (it reads the session), so this is not a prerender concern — it is
 * purely about feedback.
 *
 * THE FEEDBACK IS DELIBERATELY SPLIT ACROSS TWO MOMENTS, and it is worth knowing
 * why it looks inconsistent: SHAPE errors (too short, bad characters, reserved)
 * appear as you type, because `validateUsernameFormat` is pure and shipped to the
 * browser. WORD-BLOCK errors only appear on submit, because that list lives in a
 * `server-only` module — shipping it would hand anyone an evasion dictionary they
 * could diff to find which spellings are still available.
 */

type Availability = { available: boolean; reason?: string } | null;

const INPUT =
  "w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30";
const BTN =
  "rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white transition hover:bg-brand-600 disabled:opacity-50";

export function UsernameCard({ initialUsername }: { initialUsername: string | null }) {
  const [username, setUsername] = useState(initialUsername ?? "");
  const [saved, setSaved] = useState(initialUsername);
  const [availability, setAvailability] = useState<Availability>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  const trimmed = username.trim();
  const unchanged = trimmed === (saved ?? "");
  const format = trimmed.length > 0 ? validateUsernameFormat(trimmed) : null;
  const formatError = format && !format.ok ? USERNAME_REJECTION_MESSAGES[format.reason] : null;

  useEffect(() => {
    let active = true;
    fetch("/api/v1/me/friend-code", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { code?: string } | null) => {
        if (active && d?.code) setCode(d.code);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Debounced availability check. Skipped entirely when the shape is already
  // wrong — there is nothing to look up — or when nothing has changed.
  useEffect(() => {
    if (!format?.ok || unchanged) {
      setAvailability(null);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      fetch(`/api/v1/me/username?check=${encodeURIComponent(format.username)}`, {
        credentials: "include",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: Availability) => {
          if (active) setAvailability(d);
        })
        .catch(() => {});
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [format?.ok, format?.ok ? format.username : "", unchanged]);

  const save = useCallback(async () => {
    if (!format?.ok) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/me/username", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: format.username }),
      });
      const data = (await res.json()) as { ok?: boolean; username?: string; reason?: string };
      if (data.ok && data.username) {
        setSaved(data.username);
        setUsername(data.username);
        setMessage("Username saved.");
      } else {
        setMessage(data.reason ?? "Could not save that username.");
      }
    } catch {
      setMessage("You appear to be offline.");
    } finally {
      setBusy(false);
    }
  }, [format]);

  const rotate = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/v1/me/friend-code", {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json()) as { code?: string };
      if (data.code) setCode(data.code);
    } catch {
      /* leave the old one on screen */
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-sm font-black uppercase tracking-wide text-zinc-900">
        Username
      </h2>
      <p className="mt-2 text-sm text-muted">
        Your <strong className="text-zinc-900">@username</strong> is your unique
        public address — other players use it to find you. Your{" "}
        <strong className="text-zinc-900">display name</strong> above is what
        shows on leaderboards, and can be anything.
      </p>

      <label className="mt-4 block text-sm font-semibold text-zinc-900">
        @username
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="pick a username"
          autoComplete="off"
          spellCheck={false}
          className={INPUT}
        />
      </label>

      {formatError && (
        <p className="mt-2 text-xs font-bold text-red-700">{formatError}</p>
      )}
      {!formatError && availability && !unchanged && (
        <p
          className={`mt-2 text-xs font-bold ${
            availability.available ? "text-emerald-700" : "text-red-700"
          }`}
        >
          {availability.available ? "Available" : (availability.reason ?? "Not available")}
        </p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={busy || unchanged || !format?.ok || availability?.available === false}
        className={`${BTN} mt-4`}
      >
        {saved ? "Change username" : "Claim username"}
      </button>

      {message && (
        <p role="status" className="mt-3 text-sm font-bold text-zinc-700">
          {message}
        </p>
      )}

      <div className="mt-6 border-t border-border pt-6">
        <h3 className="text-sm font-black uppercase tracking-wide text-zinc-900">
          Friend code
        </h3>
        <p className="mt-2 text-sm text-muted">
          Share this with someone to let them add you without searching. Getting
          unwanted requests? Get a new one — the old code stops working straight
          away.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <code className="select-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm tracking-widest text-zinc-900">
            {code ? formatFriendCode(code) : "…"}
          </code>
          <button
            type="button"
            onClick={rotate}
            disabled={busy}
            className="rounded-full border border-border bg-white px-4 py-2 text-sm font-bold text-zinc-700 transition hover:bg-surface-2 disabled:opacity-50"
          >
            New code
          </button>
        </div>
      </div>
    </section>
  );
}
