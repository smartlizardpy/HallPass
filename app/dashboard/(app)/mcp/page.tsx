/**
 * `/dashboard/mcp` — what is connected to your HallPass account, and how to
 * connect something.
 *
 * ── WHY EVERY ROLE SEES THIS, NOT JUST SUPER ADMINS ───────────────────────
 * `/dashboard/users` is in the super-admin block because it is about OTHER
 * people's access. This is about YOUR OWN: a beta admin who connects a laptop
 * needs somewhere to disconnect it, and putting that behind a role they do not
 * hold would mean the only way out was asking somebody else. So the gate is
 * `DASHBOARD_MIN_ROLE` — exactly the gate on the analytics MCP itself, and on
 * the overview page these connections can read.
 *
 * A super admin additionally sees EVERY account's connections, in a second
 * section rather than by the first one changing meaning. One screen that shows
 * different things to different people is a screen nobody can describe to
 * anybody else.
 *
 * ── THE EMPTY STATE IS THE SETUP INSTRUCTIONS ─────────────────────────────
 * With nothing connected there is no information to convey, so the card carries
 * the `claude mcp add` line instead of the words "no connections yet". Getting
 * connected should not require finding the README.
 *
 * ── TWO STATUS BANNERS, AND THE SECOND IS THE CONFUSING ONE ───────────────
 * `MCP_OAUTH_ENABLED` off means nothing can connect at all, which announces
 * itself. `MCP_ANALYTICS_DATABASE_URL` unset means everything connects fine and
 * `run_analytics_sql` is silently missing from the tool list — a failure whose
 * symptom is a model saying it cannot query the database while every other tool
 * works. Naming it here is the only place that is cheap to notice.
 */

import type { Metadata } from "next";
import { requireRole } from "@/app/lib/auth";
import { DASHBOARD_MIN_ROLE } from "@/app/lib/permissions";
import { agoLabel } from "@/app/lib/insights";
import { ACCESS_TOKEN_TTL_SECONDS, isOauthEnabled } from "@/app/lib/mcp/oauth/config";
import { isAnalyticsDbConfigured } from "@/app/lib/mcp/analytics/db";
import { listGrants, listManualClients, type OauthClient, type OauthGrant } from "@/app/lib/mcp/oauth/store";
import { OAUTH_SCOPE } from "@/app/lib/mcp/oauth/config";
import { SITE_URL } from "@/app/lib/site";
import { DashHeader } from "../_ui/DashHeader";
import { Section } from "../_ui/Section";
import { CopyField } from "./CopyField";
import { RevokeConnection } from "./RevokeConnection";
import { readAppSetting } from "@/app/lib/app-settings";
import {
  OUTPUT_MODES,
  OUTPUT_MODE_HINT,
  OUTPUT_MODE_KEY,
  OUTPUT_MODE_LABEL,
  toOutputMode,
} from "@/app/lib/mcp/analytics/output-mode";
import {
  createConnectorAction,
  deleteConnectorAction,
  setOutputModeAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Connections · Dashboard",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** An amber "this is switched off" strip, matching the users page's notices. */
function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-bold">{title}</p>
      <p className="mt-1">{children}</p>
    </div>
  );
}

function Banner({ ok, error }: { ok?: string; error?: string }) {
  if (ok) {
    return (
      <div className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        {ok}
      </div>
    );
  }
  if (error) {
    return (
      <div className="mb-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
        {error}
      </div>
    );
  }
  return null;
}

function GrantTable({
  grants,
  now,
  showOwner,
  scope,
}: {
  grants: OauthGrant[];
  now: Date;
  showOwner?: boolean;
  scope?: "own" | "all";
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
            <th className="px-4 py-3">App</th>
            {showOwner && <th className="px-4 py-3">Account</th>}
            <th className="px-4 py-3">Approved</th>
            <th className="px-4 py-3">Last used</th>
            <th className="px-4 py-3">Expires</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {grants.map((grant) => (
            <tr key={grant.grantId} className="border-b border-border last:border-0">
              <td className="px-4 py-3 font-semibold text-foreground">
                {grant.clientName}
              </td>
              {showOwner && (
                <td className="px-4 py-3 text-muted">{grant.email}</td>
              )}
              <td className="px-4 py-3 tabular-nums text-muted">
                {agoLabel(grant.approvedAt, now) ?? "—"}
              </td>
              <td className="px-4 py-3 tabular-nums text-muted">
                {/* Never used is a real state and worth distinguishing from
                    "used today": a connection nobody has driven is one to
                    revoke without a second thought. */}
                {grant.lastUsedAt ? (agoLabel(grant.lastUsedAt, now) ?? "—") : "never"}
              </td>
              <td className="px-4 py-3 tabular-nums text-muted">
                {new Date(grant.expiresAt).toISOString().slice(0, 10)}
              </td>
              <td className="px-4 py-3 text-right">
                <RevokeConnection
                  grantId={grant.grantId}
                  clientName={grant.clientName}
                  scope={scope}
                  owner={showOwner ? grant.email : undefined}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The panel most visits to this page are for: the URL, and where to paste it.
 *
 * Three clients named explicitly rather than one generic instruction, because
 * the step that stops people is not "what is the URL" but "where does it go" —
 * and each app buries it somewhere different. The terminal form is last: it is
 * the one an operator can look up, and the two that matter on a phone are the
 * two hosted ones.
 */
function ConnectPanel({ url }: { url: string }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-foreground">
          Your HallPass MCP address
        </p>
        <p className="mb-2 mt-0.5 text-xs text-muted">
          Paste this into any app that supports MCP. It will open a browser and
          ask you to sign in and approve it.
        </p>
        <CopyField value={url} label="HallPass MCP URL" />
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        {[
          {
            app: "Claude",
            where: "Settings → Connectors → Add custom connector",
            note: "Web, desktop and mobile.",
          },
          {
            app: "ChatGPT",
            where: "Settings → Connectors → Add",
            note: "Draws the numbers as a card.",
          },
          {
            app: "Claude Code",
            where: "In a terminal",
            note: "claude mcp add --transport http hallpass <url>",
          },
        ].map((row) => (
          <div
            key={row.app}
            className="rounded-lg border border-border bg-surface-2 p-3"
          >
            <dt className="text-xs font-bold uppercase tracking-wide text-foreground">
              {row.app}
            </dt>
            <dd className="mt-1 text-xs text-muted">{row.where}</dd>
            <dd className="mt-1 break-words text-[11px] text-muted">{row.note}</dd>
          </div>
        ))}
      </dl>

      <p className="text-xs text-muted">
        A connection reads analytics only. It cannot write anything, and no view
        it can reach carries a player&apos;s email, real name or photo.
      </p>
    </div>
  );
}

/**
 * The Advanced disclosure.
 *
 * A `<details>` with the repo's rotating `▸`, closed by default. `list-none`
 * plus the webkit marker reset remove the browser's own triangle so the one in
 * the label is the only one — two arrows pointing different ways is the usual
 * result of forgetting it.
 */
function Advanced({ children }: { children: React.ReactNode }) {
  return (
    <details className="group rounded-xl border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-sm font-bold text-foreground [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="inline-block text-muted transition-transform group-open:rotate-90"
        >
          ▸
        </span>
        Advanced
        <span className="font-normal text-muted">
          — how answers look, and connectors you set up by hand
        </span>
      </summary>
      <div className="space-y-8 border-t border-border p-5">{children}</div>
    </details>
  );
}

/**
 * The four values a connector form asks for, and the freshly-minted secret.
 *
 * Shown ONCE. The secret is stored hashed, so this render is the only time it
 * exists anywhere — said plainly on the card, because a person who closes it
 * assuming they can come back has lost it.
 */
function NewConnector({
  clientId,
  secret,
  origin,
}: {
  clientId: string;
  secret?: string;
  origin: string;
}) {
  const rows: [string, string][] = [
    ["Authorization URL", `${origin}/oauth/authorize`],
    ["Token URL", `${origin}/api/oauth/token`],
    ["Scope", OAUTH_SCOPE],
    ["Client ID", clientId],
  ];
  if (secret) rows.push(["Client Secret", secret]);

  return (
    <div className="mb-8 rounded-xl border border-emerald-300 bg-emerald-50 p-5">
      <p className="text-sm font-bold text-emerald-900">Connector created.</p>
      <p className="mt-1 text-sm text-emerald-900">
        Paste these into the other service&apos;s form.
        {secret ? " The secret is shown once and is not stored — copy it now." : ""}
      </p>
      <dl className="mt-4 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="sm:flex sm:gap-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-emerald-900 sm:w-40 sm:shrink-0 sm:pt-1">
              {label}
            </dt>
            <dd className="min-w-0 flex-1">
              <code className="block overflow-x-auto rounded-lg border border-emerald-300 bg-white px-3 py-1.5 font-mono text-xs">
                {value}
              </code>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The hand-made connectors, listed so a forgotten one can be found and removed. */
function ConnectorTable({ clients, now }: { clients: OauthClient[]; now: Date }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Client ID</th>
            <th className="px-4 py-3">Secret</th>
            <th className="px-4 py-3">Created</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <tr key={client.clientId} className="border-b border-border last:border-0">
              <td className="px-4 py-3 font-semibold text-foreground">{client.clientName}</td>
              <td className="max-w-[16rem] truncate px-4 py-3 font-mono text-xs text-muted">
                {client.clientId}
              </td>
              <td className="px-4 py-3 text-muted">{client.secretHash ? "yes" : "public"}</td>
              <td className="px-4 py-3 tabular-nums text-muted">
                {agoLabel(client.createdAt, now) ?? "—"}
              </td>
              <td className="px-4 py-3 text-right">
                <form action={deleteConnectorAction}>
                  <input type="hidden" name="clientId" value={client.clientId} />
                  <button
                    type="submit"
                    className="rounded-full border border-border px-3 py-1 text-xs font-bold text-zinc-700 hover:bg-surface-2"
                  >
                    Delete
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function McpConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    created?: string;
    secret?: string;
  }>;
}) {
  const { email, role } = await requireRole(DASHBOARD_MIN_ROLE);
  const { ok, error, created, secret } = await searchParams;
  const now = new Date();
  const hours = Math.round(ACCESS_TOKEN_TTL_SECONDS / 3600);

  const oauthOn = isOauthEnabled();
  const sqlOn = isAnalyticsDbConfigured();

  // Fail soft to an empty list, like every other dashboard panel: an
  // unreachable database should render a screen that says so, not a 500.
  const mine = oauthOn ? await listGrants(email).catch(() => []) : [];
  const everyone =
    oauthOn && role === "super_admin" ? await listGrants(null).catch(() => []) : [];
  const others = everyone.filter((grant) => grant.email !== email);
  const connectors =
    oauthOn && role === "super_admin" ? await listManualClients().catch(() => []) : [];
  // Fail-soft through readAppSetting, so an unreachable database shows the
  // default rather than an error — the same posture the reader takes.
  const outputMode = toOutputMode(await readAppSetting(OUTPUT_MODE_KEY));

  // The origin a connector form needs. SITE_URL rather than the request's host:
  // these values are copied into another service that will call them from the
  // internet, so a localhost origin pasted there is useless.
  const origin = SITE_URL;

  const connectUrl = `${origin}/api/mcp`;

  return (
    <>
      <DashHeader
        title="Connections"
        subtitle="Apps signed in to your HallPass account for analytics"
      />

      <Banner ok={ok} error={error} />

      {created && <NewConnector clientId={created} secret={secret} origin={origin} />}

      {!oauthOn && (
        <Notice title="Signing in is switched off.">
          Nothing can connect until <code className="font-mono">MCP_OAUTH_ENABLED</code>{" "}
          is set on the deployment. Existing connections are refused meanwhile.
        </Notice>
      )}

      {oauthOn && !sqlOn && (
        <Notice title="Database queries are unavailable.">
          <code className="font-mono">MCP_ANALYTICS_DATABASE_URL</code> is not set, so
          connections work but <code className="font-mono">run_analytics_sql</code> is
          missing from the tool list entirely — an app will report that it cannot
          query the database while everything else answers. Run{" "}
          <code className="font-mono">node scripts/provision-mcp-reader.mjs --yes</code>{" "}
          to create the read-only role.
        </Notice>
      )}

      {oauthOn && (
        <Section title="Connect an app" className="mb-8">
          <ConnectPanel url={connectUrl} />
        </Section>
      )}

      <Section
        title="Your connections"
        subtitle={mine.length ? `${mine.length} active` : undefined}
        className="mb-8"
      >
        {mine.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing is connected yet. Use the address above to add one.
          </p>
        ) : (
          <>
            <GrantTable grants={mine} now={now} />
            <p className="mt-3 text-xs text-muted">
              Each app re-authorises itself in the background, so a connection
              stays usable while you use it. Access itself lasts {hours} hours at
              a time; revoking ends it immediately.
            </p>
          </>
        )}
      </Section>

      {oauthOn && (
        <Advanced>
          <section>
            <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-muted">
              How answers are presented
            </h2>
            <p className="mb-4 text-sm text-muted">
              Some apps can draw a HallPass report as a <strong>card</strong> — the
              same KPI tiles and tables as the overview — instead of formatted
              text. Support is uneven and the failure is ugly: an app that only
              half-supports it shows an <em>empty box</em> rather than falling back.
              If you see that, switch to text and the answer comes back.
            </p>

            <form action={setOutputModeAction} className="space-y-3">
              <fieldset className="space-y-2">
                <legend className="sr-only">Presentation mode</legend>
                {OUTPUT_MODES.map((mode) => (
                  <label
                    key={mode}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                      mode === outputMode
                        ? "border-brand bg-brand-50"
                        : "border-border bg-surface hover:bg-surface-2"
                    }`}
                  >
                    <input
                      type="radio"
                      name="mode"
                      value={mode}
                      defaultChecked={mode === outputMode}
                      className="mt-1"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-foreground">
                        {OUTPUT_MODE_LABEL[mode]}
                        {mode === outputMode && (
                          <span className="ml-2 text-xs font-semibold text-brand">
                            current
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {OUTPUT_MODE_HINT[mode]}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {role === "super_admin" ? (
                <button
                  type="submit"
                  className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
                >
                  Save
                </button>
              ) : (
                <p className="text-xs text-muted">
                  Only a super admin can change this — it affects every connected
                  account, not just yours.
                </p>
              )}
            </form>
          </section>

          {role === "super_admin" && (
            <section>
              <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-muted">
                Connectors for services that cannot sign themselves up
              </h2>
              <p className="mb-4 text-sm text-muted">
                Claude and ChatGPT register themselves — they need nothing here.
                Some connector forms instead ask you to <em>type in</em> an
                authorization URL, a token URL, a client ID and a secret. Create
                one of those here and paste the values across.
              </p>

              {connectors.length > 0 && (
                <div className="mb-5">
                  <ConnectorTable clients={connectors} now={now} />
                  <p className="mt-2 text-xs text-muted">
                    Deleting a connector also revokes every connection made
                    through it.
                  </p>
                </div>
              )}

              <form action={createConnectorAction} className="space-y-3">
                <label className="block text-sm font-semibold text-foreground">
                  Name
                  <input
                    name="clientName"
                    required
                    placeholder="Gemini Enterprise"
                    className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
                  />
                </label>
                <label className="block text-sm font-semibold text-foreground">
                  Redirect URIs
                  <input
                    name="redirectUris"
                    required
                    placeholder="https://the-service.example/oauth/callback"
                    className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
                  />
                  <span className="mt-1 block text-xs font-normal text-muted">
                    Whatever the other service says it will return to, exactly.
                    One per line or comma-separated. Must be https, or http on
                    localhost.
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm text-foreground">
                  <input type="checkbox" name="withSecret" defaultChecked className="mt-1" />
                  <span>
                    Issue a client secret
                    <span className="block text-xs text-muted">
                      Tick this if the other service&apos;s form has a Client
                      Secret box. It is shown once and stored hashed.
                    </span>
                  </span>
                </label>
                <button
                  type="submit"
                  className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
                >
                  Create connector
                </button>
              </form>
            </section>
          )}

          {role === "super_admin" && (
            <section>
              <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-muted">
                Everyone else&apos;s connections
                {others.length > 0 && (
                  <span className="ml-2 font-normal normal-case tracking-normal">
                    {others.length} active
                  </span>
                )}
              </h2>
              {others.length === 0 ? (
                <p className="text-sm text-muted">
                  No other account has connected an app.
                </p>
              ) : (
                <GrantTable grants={others} now={now} showOwner scope="all" />
              )}
            </section>
          )}
        </Advanced>
      )}
    </>
  );
}
