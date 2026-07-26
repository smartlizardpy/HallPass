/**
 * HallPass dashboard — client logs & diagnostics (super-admin only).
 *
 * Two things a super admin can't otherwise see from a phone:
 *   1. Environment checks — whether the build-time env vars this deployment
 *      relies on are actually present. `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` is the
 *      one behind "we got no analytics data": it is inlined at build time, so if
 *      it is missing here, the browser SDK silently captures nothing.
 *   2. The client console buffer — `console.*` output plus uncaught errors,
 *      mirrored on-device by `app/lib/console-capture.ts` and rendered live by
 *      the client `ConsoleLogViewer`.
 *
 * The route guard fails closed (`requireRole("super_admin")` bounces a plain
 * admin to `/dashboard`) and the nav link is hidden for non-super-admins — the
 * same defence-in-depth pattern as the Users page. Env values are never
 * rendered; only their presence is, so the token itself never reaches the page.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/app/lib/auth";
import { DashHeader } from "../_ui/DashHeader";
import { Section } from "../_ui/Section";
import { ConsoleLogViewer } from "./ConsoleLogViewer";

export const metadata: Metadata = {
  title: "Logs",
  description: "Client console logs and environment checks.",
  robots: { index: false, follow: false },
};

type EnvCheck = { name: string; set: boolean; note: string };

export default async function LogsPage() {
  await requireRole("super_admin");

  // Presence only — never the values. NEXT_PUBLIC_ vars are inlined at build,
  // so this reflects what the current deployment was built with.
  const checks: EnvCheck[] = [
    {
      name: "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN",
      set: !!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
      note: "Client analytics capture (browser → PostHog). Required for ANY events. Inlined at build — set it in Vercel, then redeploy.",
    },
    {
      name: "POSTHOG_PROJECT_ID",
      set: !!process.env.POSTHOG_PROJECT_ID,
      note: "Server-side play-count queries for this dashboard.",
    },
    {
      name: "POSTHOG_PERSONAL_API_KEY",
      set: !!process.env.POSTHOG_PERSONAL_API_KEY,
      note: "Server-side read access for play-count queries.",
    },
  ];

  return (
    <>
      <DashHeader
        title="Logs"
        subtitle="Environment checks and live client console output — for debugging on the go."
        action={
          <Link
            href="/dashboard"
            className="text-sm font-semibold text-brand hover:text-brand-600"
          >
            ← Back to overview
          </Link>
        }
      />

      <Section title="Environment checks" className="mb-8">
        <ul className="divide-y divide-border">
          {checks.map((check) => (
            <li
              key={check.name}
              className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <code className="font-mono text-sm font-semibold text-foreground">
                  {check.name}
                </code>
                <p className="mt-1 text-xs text-muted">{check.note}</p>
              </div>
              <span
                className={
                  check.set
                    ? "shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700"
                    : "shrink-0 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-700"
                }
              >
                {check.set ? "Set" : "Not set"}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <div className="mb-4">
        <h2 className="text-lg font-black tracking-tight">Client console</h2>
        <p className="mt-1 text-sm text-muted">
          Captured in <strong>this</strong> browser on this device (errors and
          the PostHog token warning included). It is not shared across devices or
          users.
        </p>
      </div>

      <ConsoleLogViewer />
    </>
  );
}
