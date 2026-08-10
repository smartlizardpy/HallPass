"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { PublicProfile } from "../../lib/social/store";
import type {
  IncomingChallenge,
  OutgoingChallenge,
} from "../../lib/challenges/store";
import { formatFriendCode, normalizeFriendCode } from "../../lib/username";
import { Avatar } from "./Avatar";
import { ChallengeList } from "./ChallengeList";

/**
 * The friends surface: list, incoming/outgoing requests, and the add flow.
 *
 * A CLIENT ISLAND, and `/play/friends` is a server shell that reads no session —
 * so the shell stays statically prerendered and the service worker can precache
 * it, while every byte of per-viewer data arrives from `/api/` (which the SW
 * never intercepts). That is the same split `AccountMenu` uses, and it is why
 * `/play/friends` can be left OUT of the SW's never-intercept list while
 * `/play/account` had to go in: this page's HTML contains nothing about anyone.
 *
 * Renders `null` until loaded rather than a skeleton, matching `AccountMenu`'s
 * `loaded` flag — the app has no Suspense boundaries and adding one here would
 * change the prerender shape of the shell.
 */

type Request = PublicProfile & { requestedAt: string };

type FriendsResponse = {
  signedIn: boolean;
  enabled: boolean;
  friends: PublicProfile[];
  incoming: Request[];
  outgoing: Request[];
};

type Tab = "friends" | "requests" | "challenges" | "add";

/**
 * `GET /api/v1/me/challenges`. Fetched HERE rather than inside `ChallengeList`
 * so the tab can carry a count before anybody clicks it — a badge that only
 * appeared once you opened the tab would be no badge at all.
 */
type ChallengesResponse = {
  signedIn: boolean;
  incoming: IncomingChallenge[];
  outgoing: OutgoingChallenge[];
};

const BTN_PRIMARY =
  "rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white transition hover:bg-brand-600 disabled:opacity-50";
const BTN_SECONDARY =
  "rounded-full border border-border bg-white px-4 py-2 text-sm font-bold text-zinc-700 transition hover:bg-surface-2 disabled:opacity-50";
const INPUT =
  "w-full rounded-full border border-border bg-white px-4 py-3 text-base font-semibold text-zinc-900 placeholder:text-muted outline-none transition focus:ring-4 focus:ring-brand/20";

export function FriendsIsland() {
  const [data, setData] = useState<FriendsResponse | null>(null);
  const [challenges, setChallenges] = useState<ChallengesResponse | null>(null);
  const [tab, setTab] = useState<Tab>("friends");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/me/friends", { credentials: "include" });
      if (!res.ok) return;
      setData((await res.json()) as FriendsResponse);
    } catch {
      // Offline: /api/ is never intercepted by the service worker, so this simply
      // fails and the island keeps whatever it already had.
    }
  }, []);

  /**
   * Challenges, on their own request and their own state.
   *
   * Kept separate from `load` rather than merged into one combined fetch: the
   * two endpoints fail independently, and a challenges table that is behind the
   * deploy must not blank the friends list that works perfectly well. Same
   * reasoning as `AccountMenu` firing its badge call alongside identity instead
   * of gating on it.
   */
  const loadChallenges = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/me/challenges", { credentials: "include" });
      if (!res.ok) return;
      setChallenges((await res.json()) as ChallengesResponse);
    } catch {
      // Offline — keep whatever we already had.
    }
  }, []);

  useEffect(() => {
    void load();
    void loadChallenges();
  }, [load, loadChallenges]);

  /** One mutation helper: every action is the same fetch with a different verb. */
  const act = useCallback(
    async (method: "PUT" | "DELETE", id: string, label: string) => {
      setBusy(id);
      setNotice(null);
      try {
        const res = await fetch("/api/v1/me/friends", {
          method,
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) {
          setNotice("That didn't work — try again in a moment.");
        } else {
          setNotice(label);
          await load();
        }
      } catch {
        setNotice("You appear to be offline.");
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  if (!data) return null;

  if (!data.signedIn) {
    return (
      <Panel>
        <p className="text-[15px] font-bold text-muted">
          Sign in to add friends and see what they&rsquo;re playing.
        </p>
        <a href="/play/signin?callbackUrl=/play/friends" className={`${BTN_PRIMARY} mt-4 inline-block`}>
          Sign in
        </a>
      </Panel>
    );
  }

  if (!data.enabled) {
    // The schema is behind the deploy. Say so plainly rather than showing an
    // empty friends list, which would read as "you have no friends".
    return (
      <Panel>
        <p className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          Friends aren&rsquo;t switched on yet. Check back shortly.
        </p>
      </Panel>
    );
  }

  const incomingCount = data.incoming.length;
  // Only open challenges aimed at this player earn a badge. The ones they sent
  // are not a to-do, and counting them would nag somebody about their own move.
  const challengeCount = challenges?.incoming.length ?? 0;

  return (
    <div className="space-y-4">
      <div role="tablist" className="flex flex-wrap gap-2">
        <TabButton active={tab === "friends"} onClick={() => setTab("friends")}>
          Friends {data.friends.length > 0 && `(${data.friends.length})`}
        </TabButton>
        <TabButton active={tab === "requests"} onClick={() => setTab("requests")}>
          Requests
          {incomingCount > 0 && (
            <span className="ml-1.5 rounded-full bg-accent-pink-ink px-2 py-0.5 text-[11px] font-black text-white">
              {incomingCount}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === "challenges"} onClick={() => setTab("challenges")}>
          Challenges
          {challengeCount > 0 && (
            <span className="ml-1.5 rounded-full bg-accent-pink-ink px-2 py-0.5 text-[11px] font-black text-white">
              {challengeCount}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === "add"} onClick={() => setTab("add")}>
          Add a friend
        </TabButton>
      </div>

      {notice && (
        <p
          role="status"
          className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-zinc-700"
        >
          {notice}
        </p>
      )}

      {tab === "friends" && (
        <Panel>
          {data.friends.length === 0 ? (
            <Empty>
              No friends yet. Use <strong>Add a friend</strong> to send your first
              request.
            </Empty>
          ) : (
            <ul className="divide-y divide-border">
              {data.friends.map((friend) => (
                <PersonRow key={friend.id} person={friend}>
                  <button
                    type="button"
                    disabled={busy === friend.id}
                    onClick={() => act("DELETE", friend.id, "Removed.")}
                    className={BTN_SECONDARY}
                  >
                    Remove
                  </button>
                </PersonRow>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {tab === "requests" && (
        <div className="space-y-4">
          <Panel title="Waiting for you">
            {data.incoming.length === 0 ? (
              <Empty>No one is waiting on you.</Empty>
            ) : (
              <ul className="divide-y divide-border">
                {data.incoming.map((person) => (
                  <PersonRow key={person.id} person={person}>
                    <button
                      type="button"
                      disabled={busy === person.id}
                      onClick={() => act("PUT", person.id, "You're now friends.")}
                      className={BTN_PRIMARY}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      disabled={busy === person.id}
                      onClick={() => act("DELETE", person.id, "Declined.")}
                      className={BTN_SECONDARY}
                    >
                      Decline
                    </button>
                  </PersonRow>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Sent by you">
            {data.outgoing.length === 0 ? (
              <Empty>You haven&rsquo;t sent any requests.</Empty>
            ) : (
              <ul className="divide-y divide-border">
                {data.outgoing.map((person) => (
                  <PersonRow key={person.id} person={person}>
                    <button
                      type="button"
                      disabled={busy === person.id}
                      onClick={() => act("DELETE", person.id, "Request cancelled.")}
                      className={BTN_SECONDARY}
                    >
                      Cancel
                    </button>
                  </PersonRow>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {tab === "challenges" && (
        <Panel>
          <ChallengeList
            incoming={challenges?.incoming ?? []}
            outgoing={challenges?.outgoing ?? []}
            onChanged={loadChallenges}
          />
        </Panel>
      )}

      {tab === "add" && <AddFriend onChanged={load} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function AddFriend({ onChanged }: { onChanged: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfile[]>([]);
  /** Whether the current query has come back from the server. */
  const [searched, setSearched] = useState(false);
  const [code, setCode] = useState("");
  const [myCode, setMyCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fetch the caller's own code lazily — the endpoint mints one on first read.
  useEffect(() => {
    let active = true;
    fetch("/api/v1/me/friend-code", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { display?: string } | null) => {
        if (active && d?.display) setMyCode(d.display);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Debounced search. 250ms is short enough to feel live and long enough that a
  // typed word is one request rather than eight.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setSearched(false);
      return;
    }
    let active = true;
    setSearched(false);
    const timer = setTimeout(() => {
      fetch(`/api/v1/me/friends/search?q=${encodeURIComponent(q)}`, {
        credentials: "include",
      })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d: { results?: PublicProfile[] }) => {
          if (!active) return;
          setResults(d.results ?? []);
          // Only NOW is an empty list meaningful. Before this the same empty
          // array meant "we have not asked yet", and rendering nothing for both
          // is what made a search that found nobody look like a broken feature.
          setSearched(true);
        })
        .catch(() => {});
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const send = useCallback(
    async (body: Record<string, string>) => {
      setBusy(true);
      setMessage(null);
      try {
        const res = await fetch("/api/v1/me/friends", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { state?: string };
        setMessage(STATE_MESSAGES[data.state ?? ""] ?? "That didn't work.");
        if (data.state === "sent" || data.state === "accepted") {
          setQuery("");
          setResults([]);
          setCode("");
          await onChanged();
        }
      } catch {
        setMessage("You appear to be offline.");
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );

  return (
    <div className="space-y-4">
      <Panel title="Search by name or username">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="name or @username"
          aria-label="Search for a player by name or username"
          className={INPUT}
        />
        {query.trim().length > 0 && query.trim().length < 3 && (
          <p className="mt-2 text-xs font-bold text-muted">
            Keep typing — at least 3 characters.
          </p>
        )}
        {/*
          A search that finds nobody MUST say so. Rendering nothing for "no
          matches" and nothing for "haven't searched yet" made a working search
          indistinguishable from a broken one — which is exactly how it was
          reported. The friend-code hint is here because it is the answer in the
          most common case: the person you are looking for has not picked a
          username yet, and a code works regardless.
        */}
        {searched && results.length === 0 && (
          <p className="mt-3 text-sm font-semibold text-muted">
            Nobody found matching{" "}
            <span className="font-bold text-zinc-900">{query.trim()}</span>. Check
            the spelling, or ask them for their friend code below — that works even
            if they haven&rsquo;t picked a username.
          </p>
        )}
        {results.length > 0 && (
          <ul className="mt-3 divide-y divide-border">
            {results.map((person) => (
              <PersonRow key={person.id} person={person}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => send({ id: person.id })}
                  className={BTN_PRIMARY}
                >
                  Add
                </button>
              </PersonRow>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Add by friend code">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send({ friendCode: code });
          }}
          className="flex flex-wrap gap-2"
        >
          <input
            value={code}
            // Folded as they type, so O/I/L/S/B/Z land on the canonical character
            // and a mistyped code still resolves.
            onChange={(e) => setCode(normalizeFriendCode(e.target.value))}
            placeholder="HP-XXXX-XXXX"
            aria-label="Friend code"
            className={`${INPUT} flex-1 font-mono uppercase tracking-widest`}
          />
          <button type="submit" disabled={busy || code.length < 8} className={BTN_PRIMARY}>
            Add
          </button>
        </form>
        {myCode && (
          <p className="mt-4 text-sm font-bold text-muted">
            Your code:{" "}
            <span className="select-all font-mono tracking-widest text-zinc-900">
              {myCode}
            </span>
          </p>
        )}
      </Panel>

      {message && (
        <p role="status" className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-zinc-700">
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * Copy per send outcome.
 *
 * `unavailable` covers both "no such player" and "blocked", and the message says
 * neither — distinguishing them would turn the send endpoint into a
 * username-existence oracle.
 */
const STATE_MESSAGES: Record<string, string> = {
  sent: "Request sent.",
  accepted: "You're now friends — they'd already asked you.",
  already: "You've already got a request with them.",
  cooldown: "You've already asked them recently. Give it a day.",
  "rate-limited": "That's a lot of requests. Try again a bit later.",
  "at-capacity": "You've hit the limit on friends or pending requests.",
  unavailable: "No one found with that name or code.",
};

function Panel({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-5 sm:p-6">
      {title && (
        <h2 className="mb-3 text-[11px] font-black uppercase tracking-wider text-muted">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px] font-semibold text-muted">{children}</p>;
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-extrabold transition ${
        active ? "bg-brand text-white" : "bg-white text-zinc-700 hover:bg-surface-2"
      }`}
    >
      {children}
    </button>
  );
}

function PersonRow({
  person,
  children,
}: {
  person: PublicProfile;
  children: React.ReactNode;
}) {
  // No username, no profile page — `/u/[username]` is the only route there is, so
  // somebody who has not claimed one simply is not linkable. Rendering a dead
  // link would be worse than rendering none.
  const href = person.username ? `/u/${encodeURIComponent(person.username)}` : null;

  const identity = (
    <>
      <Avatar person={person} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-extrabold text-zinc-900">
          {person.displayName}
        </p>
        {/* The @username is shown alongside the display name on EVERY surface,
            because display handles are not unique — without it, impersonating a
            friend by copying their handle is a two-second attack. */}
        {person.username && (
          <p className="truncate text-[13px] font-bold text-muted">@{person.username}</p>
        )}
      </div>
    </>
  );

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      {/*
        ONLY THE AVATAR AND NAME ARE THE LINK — never the whole row. Every row
        carries its own action button (Add, Accept, Remove), and a button nested
        inside an anchor is invalid HTML that browsers resolve inconsistently:
        the click either navigates instead of acting, or does both. `GameCard`
        already had to be fixed for exactly this, and its docblock states the
        invariant; this keeps to it by making the link and the buttons siblings.
      */}
      {href ? (
        <Link
          href={href}
          className="-mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 py-1 transition hover:bg-surface-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
        >
          {identity}
        </Link>
      ) : (
        identity
      )}
      <div className="flex shrink-0 gap-2">{children}</div>
    </li>
  );
}

export { formatFriendCode };
