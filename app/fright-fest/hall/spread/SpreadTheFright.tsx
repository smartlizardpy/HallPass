"use client";

/**
 * "Spread the Fright" (`#spread`) on /fright-fest: copy a post, invite a friend,
 * copy a comment. Nothing here posts anywhere or asks for a social login: it only
 * puts text on the player's clipboard.
 *
 * The page is STATIC, so everything live is fetched after hydration:
 *   1. a friend landing on `?fref=<token>` posts the token to /api/v1/referrals/visit
 *      (which stores it first-touch in a cookie), then the param is removed from the URL
 *      so their own shares never carry somebody else's code;
 *   2. /api/v1/referrals/me gives the player's token and counts.
 * Signed out, the post and comment still copy (with the plain event link); only the
 * personal link needs an account. Sharing is never a requirement for playing.
 *
 * Accessibility: real buttons, a native <dialog> (focus trap + Esc), one polite
 * live region for every copy result, the link in a readonly input that is also the
 * manual-copy fallback, and reduced-motion respected (spread.css).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { startSignIn } from "@/app/lib/auth-actions";
import { REFERRAL_FRIGHT_FEST_2026 as CONFIG } from "@/app/lib/referrals/config";
import { buildComment, buildInviteMessage, buildPost, referralLink } from "@/app/lib/referrals/copy";
import {
  COPIED,
  MANUAL,
  copyText,
  inviteState,
  progressLabel,
  readLandingToken,
  rewardBanner,
  type MeBody,
  type Seen,
} from "./logic";
import "./spread.css";

type Kind = "post_copy" | "comment_copy" | "link_copy" | "message_copy" | "invite_open";

const SEEN_KEY = "hp:ff26:referral-seen";

function track(kind: Kind) {
  // Fire and forget: a failed tally must never get in the way of a copy.
  void fetch("/api/v1/referrals/track", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind }),
  }).catch(() => undefined);
}

function legacyCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}

function readSeen(): Seen | null {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return raw ? (JSON.parse(raw) as Seen) : null;
  } catch {
    return null;
  }
}
function writeSeen(seen: Seen) {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* private mode: the banner may repeat, which is harmless */
  }
}

export function SpreadTheFright() {
  const [me, setMe] = useState<MeBody | null>(null);
  const [failed, setFailed] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [copied, setCopied] = useState<Kind | null>(null);
  const [manual, setManual] = useState<{ title: string; text: string; inDialog: boolean } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const inviteBtn = useRef<HTMLButtonElement | null>(null);
  const manualRef = useRef<HTMLTextAreaElement | null>(null);
  const linkRef = useRef<HTMLInputElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      // A friend arriving on a referral link is recorded BEFORE the read, so the cookie and any attribution exist by then.
      const { token, cleaned } = readLandingToken(window.location.search, CONFIG.param);
      if (token) {
        await fetch("/api/v1/referrals/visit", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        }).catch(() => undefined);
        window.history.replaceState(null, "", `${window.location.pathname}${cleaned}${window.location.hash}`);
      }
      const res = await fetch("/api/v1/referrals/me", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as MeBody;
      setMe(body);
      if (body.signedIn && body.available) {
        const b = rewardBanner(body, readSeen());
        if (b) {
          setBanner(b.text);
          setAnnounce(b.text);
          writeSeen(b.seen);
        }
      }
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  // A selected manual-copy box is the whole point of the fallback.
  useEffect(() => {
    if (manual) {
      manualRef.current?.focus();
      manualRef.current?.select();
    }
  }, [manual]);

  const state = inviteState(me, failed);
  const token = state.kind === "ready" || state.kind === "paused" || state.kind === "closed" ? (me?.token ?? null) : null;
  const personal = state.kind === "ready" && !!token;
  const link = referralLink(CONFIG, personal ? token : null);
  const rules = me?.rules ?? { enabled: true, bonus: CONFIG.bonus, cap: CONFIG.cap };

  async function copy(kind: Exclude<Kind, "invite_open">, text: string, title: string, saidOk: string): Promise<boolean> {
    const result = await copyText(text, {
      clipboard: typeof navigator !== "undefined" ? navigator.clipboard : null,
      legacy: legacyCopy,
    });
    track(kind);
    if (result === "copied") {
      setManual(null);
      setCopied(kind);
      setAnnounce(saidOk);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 2200);
      return true;
    }
    setCopied(null);
    setManual({ title, text, inDialog: dialogRef.current?.open === true });
    setAnnounce(MANUAL);
    return false;
  }

  function openInvite() {
    track("invite_open");
    dialogRef.current?.showModal();
  }
  function closeInvite() {
    dialogRef.current?.close();
    inviteBtn.current?.focus();
  }

  const label = (kind: Kind, idle: string) => (copied === kind ? "Copied!" : idle);
  const used = me?.rewarded ?? 0;
  const pct = rules.cap > 0 ? Math.min(100, Math.round((Math.min(used, rules.cap) / rules.cap) * 100)) : 0;

  return (
    <section id="spread" aria-labelledby="spread-h" className="ar-sec ar-board ff-spread scroll-mt-24">
      <div className="ar-head">
        <h2 id="spread-h">
          <span aria-hidden="true">🎃 </span>SPREAD THE FRIGHT!
        </h2>
      </div>
      <p className="ar-lede">
        The more friends who join, the more fun it gets. Share Fright Fest, invite your friends and earn bonus candy!
      </p>
      <p role="status" className="sr-only">
        {announce}
      </p>

      {banner ? (
        <p className="ff-spread-banner" role="status">
          <span aria-hidden="true">👻 </span>
          {banner}
        </p>
      ) : null}

      <div className="ff-spread-grid">
        <article className="ff-spread-card" aria-labelledby="spread-post-h">
          <span className="ff-spread-icon" aria-hidden="true">📜</span>
          <h3 id="spread-post-h">Copy a Post</h3>
          <p>Got a social account? Help spread the word.</p>
          <button
            type="button"
            className={`ar-btn ${copied === "post_copy" ? "ff-spread-done" : ""}`}
            onClick={() => copy("post_copy", buildPost(CONFIG, link), "Your post", COPIED.post)}
          >
            {label("post_copy", "Copy Post")}
          </button>
        </article>

        <article className="ff-spread-card ff-spread-card-invite" aria-labelledby="spread-invite-h">
          <span className="ff-spread-icon" aria-hidden="true">👻</span>
          <h3 id="spread-invite-h">Invite a Friend</h3>
          <p>Earn bonus candy when a new friend joins and plays.</p>
          <button ref={inviteBtn} type="button" className="ar-btn ar-btn-gold ff-spread-glow" onClick={openInvite} aria-haspopup="dialog">
            Invite a Friend to HallPass to Win More Candy
          </button>
          {state.kind === "ready" ? (
            <p className="ff-spread-mini">{progressLabel(used, rules.cap)}</p>
          ) : null}
        </article>

        <article className="ff-spread-card" aria-labelledby="spread-comment-h">
          <span className="ff-spread-icon" aria-hidden="true">🕸️</span>
          <h3 id="spread-comment-h">Copy a Comment</h3>
          <p>A quick message to share in relevant conversations.</p>
          <button
            type="button"
            className={`ar-btn ${copied === "comment_copy" ? "ff-spread-done" : ""}`}
            onClick={() => copy("comment_copy", buildComment(CONFIG, link), "Your comment", COPIED.comment)}
          >
            {label("comment_copy", "Copy Comment")}
          </button>
        </article>
      </div>

      {manual && !manual.inDialog ? (
        <div className="ff-spread-manual">
          <label htmlFor="spread-manual-box">{manual.title}: select and copy</label>
          <textarea id="spread-manual-box" ref={manualRef} readOnly rows={6} value={manual.text} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="ar-btn" onClick={() => setManual(null)}>
            Done
          </button>
        </div>
      ) : null}

      <p className="ff-spread-foot">Sharing is optional: you never need to invite anyone to play.</p>

      <dialog ref={dialogRef} className="ff-spread-dialog" onClose={() => setManual((m) => (m?.inDialog ? null : m))} aria-labelledby="spread-dialog-h" onClick={(e) => e.target === dialogRef.current && closeInvite()}>
        <div className="ff-spread-dialog-body">
          <h2 id="spread-dialog-h">BRING YOUR FRIENDS INTO THE FRIGHT!</h2>
          <p>
            Share your personal invitation link. When a new friend joins HallPass and completes their first eligible Fright Fest game, you earn
            bonus candy!
          </p>

          {state.kind === "loading" ? <p role="status">Loading your link…</p> : null}
          {state.kind === "unavailable" ? <p role="alert">Invites are unavailable right now. Try again in a little while.</p> : null}
          {state.kind === "signed-out" ? (
            <>
              <p>Sign in to get your own link. Friends who join through it earn you candy.</p>
              <form action={startSignIn}>
                <button type="submit" className="ar-btn ar-btn-gold">
                  Sign in to get my link
                </button>
              </form>
            </>
          ) : null}
          {state.kind === "paused" ? <p>Friend rewards are paused right now. Your link still works for sharing.</p> : null}
          {state.kind === "closed" ? <p>Fright Fest friend rewards have ended. Thanks for spreading the fright!</p> : null}

          {state.kind === "ready" || state.kind === "paused" || state.kind === "closed" ? (
            <>
              <label htmlFor="spread-link" className="ff-spread-label">
                Your invitation link
              </label>
              <input
                id="spread-link"
                ref={linkRef}
                className="ff-spread-link"
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="ff-spread-actions">
                <button
                  type="button"
                  className={`ar-btn ar-btn-gold ff-spread-big ${copied === "link_copy" ? "ff-spread-done" : ""}`}
                  onClick={async () => {
                    if (!(await copy("link_copy", link, "Your link", COPIED.link))) linkRef.current?.select();
                  }}
                >
                  {label("link_copy", "Copy Invite Link")}
                </button>
                <button
                  type="button"
                  className={`ar-btn ${copied === "message_copy" ? "ff-spread-done" : ""}`}
                  onClick={() => copy("message_copy", buildInviteMessage(CONFIG, link), "Your message", COPIED.message)}
                >
                  {label("message_copy", "Copy Invite Message")}
                </button>
              </div>
            </>
          ) : null}

          {state.kind === "ready" ? (
            <dl className="ff-spread-stats">
              <div>
                <dt>Friends who joined</dt>
                <dd>{used}</dd>
              </div>
              <div>
                <dt>Candy earned</dt>
                <dd>{me?.candy ?? 0}</dd>
              </div>
              <div>
                <dt>Rewards left</dt>
                <dd>{me?.remaining ?? 0}</dd>
              </div>
              <div>
                <dt>Waiting to play</dt>
                <dd>{me?.pending ?? 0}</dd>
              </div>
            </dl>
          ) : null}
          {state.kind === "ready" ? (
            <>
              <div className="ff-spread-bar" role="progressbar" aria-label="Friends rewarded" aria-valuemin={0} aria-valuemax={rules.cap} aria-valuenow={Math.min(used, rules.cap)} aria-valuetext={progressLabel(used, rules.cap)}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <p className="ff-spread-mini">
                {state.capReached
                  ? `You have earned the most candy from invites (${rules.cap} friends). Your link still works, but no further bonus candy can be earned.`
                  : `${progressLabel(used, rules.cap)} · +${rules.bonus} candy for each new friend who plays.`}
              </p>
            </>
          ) : null}

          {manual?.inDialog ? (
            <div className="ff-spread-manual">
              <label htmlFor="spread-manual-box">{manual.title}: select and copy</label>
              <textarea id="spread-manual-box" ref={manualRef} readOnly rows={5} value={manual.text} onFocus={(e) => e.currentTarget.select()} />
            </div>
          ) : null}

          <button type="button" className="ar-btn ff-spread-close" onClick={closeInvite}>
            Close
          </button>
        </div>
      </dialog>
    </section>
  );
}
