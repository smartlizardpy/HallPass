# Deploy notifications — design

When a new production version goes live, every admin gets a bell row and — for
admins who opted in to push on a device — a Web Push saying what shipped.
Players get nothing.

## The shape

```
push to main / workflow_dispatch
  └─ .github/workflows/deploy.yml
       ├─ build, `vercel deploy --prebuilt --prod`
       └─ final step (non-fatal, opt-in on ALERTS_SECRET)
            └─ scripts/notify-deploy.mjs     thin: sha + raw commit message
                 └─ POST /api/v1/admin/deploy/notify   (alertsAuthGate)
                      ├─ deploys/parse.ts       validate sha, derive title + PR
                      ├─ notifications/copy.ts  deployCopy
                      └─ notifications/deliver.ts  notifyAdmins → bell + push
```

No migration. The admin audience, the per-admin on/off switches, the push
transport and the dedupe all already exist for the site alerts; a deploy is one
more kind (`deploy_shipped`, group "Deploys", default channel push).

## Why a post-deploy step calling an admin endpoint

A deploy is an event only CI sees. The step reuses the authenticated cron→endpoint
pattern from `alerts.yml` and the same `ALERTS_SECRET`, so there is nothing new to
provision. Rejected: a Vercel deploy webhook (new config and signature code, and
it cannot see the commit subject cleanly); the site noticing a new build id on its
first request (races, fires per instance, does not know what shipped); polling.

## Decisions

- **Dedupe on the full sha.** `deploy:<sha>` is the `notifications.dedupe_key`
  (suffixed per admin by `deliver.ts`). Re-running the workflow, or dispatching it
  for the same commit — including a deliberate redeploy to refresh cover art —
  files nothing and buzzes nobody.
- **The new deployment, not the old one.** The step runs after `vercel deploy
  --prod` returns, posting to the canonical site (the deployment URL is behind
  Vercel's deployment protection). A request that briefly reaches the old build is
  harmless: both share one database, so the row is filed anyway. The one real
  failure is the old build lacking the route, which can only happen on the first
  deploy that ships it; the script retries network errors, 404 and 5xx three
  times, ten seconds apart, and never retries 400, 401 or 503.
- **It never fails the deploy.** The site is already live when this runs. Every
  failure is a `::warning::` and exit 0, and the step is `continue-on-error`.
  Without `ALERTS_SECRET` a sibling step explains what to set.
- **The server words the notification, from a raw message.** The runner sends the
  sha and the commit message unmodified. A merge commit's subject ("Merge pull
  request #129 from …") is useless, so the title is the first body line; a squash
  merge's `(#123)` suffix becomes the PR number; otherwise it is the subject.
- **Commit text is in the full copy only.** This is the deliberate exception to
  "the server words its own notifications" (`alerts/wording.ts`), because a deploy
  with no "what" is barely worth a buzz. The damage is bounded: control and bidi
  characters are stripped, the title is length-limited, only admins receive it,
  and the discreet push says "The site was updated." and nothing else.
- **The link is `/dashboard`.** Notification URLs are app-relative by rule (an
  absolute URL would be an open redirect), so the PR cannot be linked; the short
  sha and `(#PR)` are in the body text.
- **The commit message reaches the script only via `env:`.** Interpolating
  `${{ github.event.head_commit.message }}` into a `run:` script would let a
  crafted commit message run as shell.

## What it does NOT do

- **Two merges close together announce only the newer one.** `deploy.yml` has
  `concurrency: cancel-in-progress: true`, so when a second merge lands while the
  first deploy is still running, the first run is cancelled before it reaches the
  notify step. The first merge is never announced, and the newer notification
  names only its own merge's title — even though the live version contains both.
  Accepted: the newer notification is the version that is actually live.
- A deploy that fails is not announced (it never reaches the step).
- Preview deployments, changelog pages and notifying players are out of scope.
- The first deploy that ships this feature cannot announce itself if the request
  reaches the old build; the script warns and moves on.
