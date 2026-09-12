/**
 * `/oauth/authorize` — the one screen a person sees while connecting an MCP
 * client to their HallPass account.
 *
 * ── WHY IT LOOKS LIKE `/dashboard/signin` ─────────────────────────────────
 * Same centred `max-w-md` card on `bg-background`, same `Wordmark`, same type
 * scale. Not laziness: this is literally the page you arrive at either side of
 * signing in there, and a consent screen in a different visual language reads
 * as a third-party interstitial — which is exactly the thing people are taught
 * to be suspicious of. One flow, one card.
 *
 * ── FOUR STATES, AND THREE OF THEM ARE REFUSALS ───────────────────────────
 *   1. Not signed in        → the Google button, with the client named so it is
 *                             clear what the sign-in is FOR.
 *   2. Signed in, no role   → a plain "this is for admins" card with a way out.
 *   3. Request is malformed → an error card. NEVER a redirect; see
 *                             `oauth/request.ts` for why that distinction is
 *                             the difference between an authorization server
 *                             and an open redirector.
 *   4. Signed in with a role→ the consent card.
 *
 * ── THE CONSENT CARD LISTS WHAT IS WITHHELD, NOT JUST WHAT IS GRANTED ─────
 * A dialog that enumerates permissions teaches nobody anything — every one of
 * them reads as "this app needs this to work". The half that carries
 * information is the half saying what it still cannot do, because that is the
 * part a reader cannot infer and the part that is actually true here: every
 * tool an OAuth caller can reach is read-only (`analytics-mcp-design.md` §3).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { auth, signIn, signOut } from "@/app/lib/auth";
import { Wordmark } from "@/app/components/Wordmark";
import { getUserRole } from "@/app/lib/dashboard-users";
import { DASHBOARD_MIN_ROLE, ROLE_LABEL, atLeast } from "@/app/lib/permissions";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_CLIENT_NAME,
  isOauthEnabled,
} from "@/app/lib/mcp/oauth/config";
import { mcpResource } from "@/app/lib/mcp/oauth/metadata";
import { checkAuthorizeRequest } from "@/app/lib/mcp/oauth/request";
import { resolveOauthClient } from "@/app/lib/mcp/oauth/client";
import { approveConnection, denyConnection } from "./actions";

export const metadata: Metadata = {
  title: "Connect an app · HallPass",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Query = Record<string, string | string[] | undefined>;

/** This deployment's own origin — the same derivation the actions use. */
async function currentOrigin(): Promise<string> {
  const head = await headers();
  const host = head.get("x-forwarded-host") ?? head.get("host") ?? "localhost:3000";
  const proto = head.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** The shell every state renders inside, so the four never drift apart. */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8">
        <div className="text-center">
          <Wordmark size="text-3xl" dotClass="h-2 w-2" />
        </div>
        {children}
      </div>
    </main>
  );
}

/** A refusal with a heading and a paragraph. Used by states 2 and 3. */
function Refusal({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <h1 className="mt-4 text-center text-xl font-black tracking-tight">{title}</h1>
      <p className="mt-3 text-center text-sm text-muted">{detail}</p>
      {children}
    </>
  );
}

/** One line of the "what it can / cannot do" lists. */
function Grant({ can, children }: { can: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 text-sm">
      <span
        aria-hidden
        className={`mt-0.5 shrink-0 font-black ${can ? "text-brand" : "text-muted"}`}
      >
        {can ? "+" : "−"}
      </span>
      <span className={can ? "text-foreground" : "text-muted"}>{children}</span>
    </li>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const query = await searchParams;

  if (!isOauthEnabled()) {
    return (
      <Card>
        <Refusal
          title="Signing in is not enabled here"
          detail="This deployment has not turned on MCP sign-in. An administrator needs to set MCP_OAUTH_ENABLED before any application can connect."
        />
      </Card>
    );
  }

  const origin = await currentOrigin();
  const clientId = typeof query.client_id === "string" ? query.client_id : "";
  // Either namespace: an opaque id from dynamic registration, or an https URL
  // that serves its own metadata document (`oauth/cimd.ts`).
  const resolved = clientId ? await resolveOauthClient(clientId) : null;
  const client = resolved?.ok ? resolved.client : null;
  const checked = checkAuthorizeRequest(
    query,
    client,
    mcpResource(origin),
    resolved && !resolved.ok ? resolved.reason : undefined,
  );

  // State 3. Rendered, never redirected — there is no address yet that HallPass
  // is willing to send a browser to.
  if (checked.kind === "render-error") {
    return (
      <Card>
        <Refusal title={checked.title} detail={checked.detail} />
        <p className="mt-6 text-center text-xs text-muted">
          Nothing was sent anywhere and no access was granted.
        </p>
      </Card>
    );
  }

  // A malformed-but-redirectable request is the client's problem to hear about,
  // so it is bounced straight back rather than shown to a person who cannot act
  // on it. The `<meta>`-free server redirect keeps the code path identical to
  // the actions'.
  if (checked.kind === "redirect-error") {
    const url = new URL(checked.redirectUri);
    url.searchParams.set("error", checked.error);
    url.searchParams.set("error_description", checked.detail);
    if (checked.state) url.searchParams.set("state", checked.state);
    return (
      <Card>
        <Refusal
          title="That request could not be used"
          detail={checked.detail}
        >
          <a
            href={url.toString()}
            className="mt-6 block w-full rounded-full bg-brand px-5 py-2 text-center text-sm font-extrabold text-white hover:bg-brand-600"
          >
            Return to the application
          </a>
        </Refusal>
      </Card>
    );
  }

  const { params } = checked;
  const clientName = client?.clientName ?? DEFAULT_CLIENT_NAME;
  const session = await auth().catch(() => null);
  const email = session?.user?.email?.trim().toLowerCase() ?? null;

  // The URL to come back to after Google. Rebuilt from the VALIDATED params
  // rather than echoing the raw query, so nothing unvetted survives the hop.
  const returnTo = (() => {
    const url = new URL("/oauth/authorize", origin);
    url.searchParams.set("client_id", params.clientId);
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("code_challenge", params.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (params.state) url.searchParams.set("state", params.state);
    if (params.resource) url.searchParams.set("resource", params.resource);
    return `${url.pathname}${url.search}`;
  })();

  // State 1 — not signed in. The client is named here rather than on a generic
  // sign-in page, because "why am I being asked to sign in" is the question.
  if (!email) {
    return (
      <Card>
        <h1 className="mt-4 text-center text-xl font-black tracking-tight">
          Sign in to connect <span className="text-brand">{clientName}</span>
        </h1>
        <p className="mt-3 text-center text-sm text-muted">
          HallPass needs to know who is approving this. Sign in with the Google
          account you use for the dashboard.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: returnTo });
          }}
          className="mt-6"
        >
          <button
            type="submit"
            className="w-full rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
          >
            Continue with Google
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-muted">
          You will be shown exactly what {clientName} can read before anything is
          granted.
        </p>
      </Card>
    );
  }

  // Re-resolved from the store, not read off the token: the session's role can
  // be up to one request stale and this is the request that matters.
  const role = await getUserRole(email).catch(() => null);

  // State 2 — signed in, but this is a dashboard surface.
  if (!role || !atLeast(role, DASHBOARD_MIN_ROLE)) {
    return (
      <Card>
        <Refusal
          title="This account cannot connect apps"
          detail="Connecting an app to HallPass analytics needs a dashboard role. You are signed in as a player, which does not have one."
        >
          <p className="mt-4 text-center text-xs text-muted">
            Signed in as <span className="font-semibold text-foreground">{email}</span>
          </p>
          <Link
            href="/play/you"
            className="mt-6 block w-full rounded-full bg-brand px-5 py-2 text-center text-sm font-extrabold text-white hover:bg-brand-600"
          >
            Go to your account
          </Link>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: returnTo });
            }}
            className="mt-3"
          >
            <button
              type="submit"
              className="w-full rounded-full border border-border bg-white px-5 py-2 text-sm font-bold text-zinc-700 hover:bg-surface-2"
            >
              Sign in with a different account
            </button>
          </form>
        </Refusal>
      </Card>
    );
  }

  // State 4 — the consent card.
  const hours = Math.round(ACCESS_TOKEN_TTL_SECONDS / 3600);
  const hidden = (
    <>
      <input type="hidden" name="client_id" value={params.clientId} />
      <input type="hidden" name="redirect_uri" value={params.redirectUri} />
      <input type="hidden" name="response_type" value="code" />
      <input type="hidden" name="code_challenge" value={params.codeChallenge} />
      <input type="hidden" name="code_challenge_method" value="S256" />
      <input type="hidden" name="state" value={params.state ?? ""} />
      <input type="hidden" name="scope" value={params.scope ?? ""} />
      <input type="hidden" name="resource" value={params.resource ?? ""} />
    </>
  );

  return (
    <Card>
      <h1 className="mt-4 text-center text-xl font-black tracking-tight">
        Connect <span className="text-brand">{clientName}</span> to HALLPASS
      </h1>

      <div className="mt-4 flex items-center justify-center gap-2 text-xs">
        <span className="text-muted">{email}</span>
        <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-bold text-foreground">
          {ROLE_LABEL[role]}
        </span>
      </div>

      <ul className="mt-6 space-y-2.5">
        <Grant can>
          Read your arcade analytics — plays, players, searches, retention and
          alerts
        </Grant>
        <Grant can>
          Run read-only queries against a view of the database with emails, real
          names and photos removed
        </Grant>
      </ul>

      <ul className="mt-4 space-y-2.5 border-t border-border pt-4">
        <Grant can={false}>It cannot post, edit or delete anything</Grant>
        <Grant can={false}>It cannot close bug reports or pay XP</Grant>
        <Grant can={false}>
          It cannot see any player&apos;s email address, real name or photo
        </Grant>
      </ul>

      <form action={approveConnection} className="mt-6">
        {hidden}
        <button
          type="submit"
          className="w-full rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
        >
          Approve
        </button>
      </form>
      <form action={denyConnection} className="mt-3">
        {hidden}
        <button
          type="submit"
          className="w-full rounded-full border border-border bg-white px-5 py-2 text-sm font-bold text-zinc-700 hover:bg-surface-2"
        >
          Cancel
        </button>
      </form>

      <p className="mt-5 text-center text-xs text-muted">
        Access expires in {hours} hours. Revoke it any time at{" "}
        <Link href="/dashboard/mcp" className="underline">
          Dashboard → Connections
        </Link>
        .
      </p>
      <p className="mt-2 break-all text-center text-[11px] text-muted">
        Returns to {params.redirectUri}
      </p>
    </Card>
  );
}
