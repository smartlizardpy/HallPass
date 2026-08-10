-- HallPass — migration: Web Push subscriptions.
--
-- See `app/lib/push/schema.sql` for the canonical fresh-install DDL and
-- `challenge-design.md` for the full argument; keep all three in lockstep.
--
-- WHAT. One row per DEVICE that has agreed to be notified — not per player. A
-- person with a phone and a school Chromebook has two, and that is the point:
-- the browser mints a separate subscription per browser profile, and pushing to
-- the wrong one is not "slightly wrong", it is silence.
--
-- WHY `endpoint` IS THE PRIMARY KEY. The endpoint URL is what the push service
-- issues and is unique by construction, so it is the natural key and re-running
-- a subscribe for a device the player already registered is an idempotent upsert
-- rather than a duplicate. A surrogate id would need a UNIQUE on `endpoint`
-- anyway, plus a lookup to find it.
--
-- WHY THERE IS NO EXPIRY COLUMN AND NO SWEEPER. There is no cron in this repo
-- (`007_social_graph.sql` says so outright). Dead subscriptions are pruned
-- INLINE: a push service answers `404`/`410 Gone` for an endpoint that no longer
-- exists, and the send path deletes the row on that response. Hygiene therefore
-- happens exactly when it is discoverable and costs no scheduled job. The table
-- is bounded by players x their devices regardless.
--
-- WHY THE KEYS ARE STORED AT ALL. `p256dh` and `auth` are the browser's own
-- public key material for the payload encryption; without them a push can only
-- be a contentless wake-up. They are per-device public values, not secrets about
-- the person — but note what is NOT here: no user agent, no device name, no IP.
-- A subscriptions table is a device inventory if you let it become one.
--
-- PRIVACY OF THE PAYLOAD ITSELF is not this table's business and is decided at
-- send time: the notification body is redacted per-device from a flag mirrored
-- into IndexedDB, because a service worker cannot read `localStorage` where the
-- stealth preferences live. See `app/lib/push/payload.ts`.
--
-- Fully idempotent — every statement guarded, whole file in one transaction —
-- following `021_tracker.sql` rather than the "RUN ONCE" migrations.

BEGIN;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  -- The push service's URL for this device. Long (some services emit ~500
  -- chars), opaque, and unique — TEXT with no length CHECK on purpose, because
  -- guessing a ceiling here would reject a valid subscription from a service
  -- whose format we have never seen.
  endpoint     TEXT PRIMARY KEY,

  player_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,

  -- The browser's public key and auth secret for payload encryption. Required:
  -- a row without them could only carry a contentless push.
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Bumped on every re-subscribe, so the per-player device cap can evict the
  -- least recently seen rather than the oldest — a phone used daily for two
  -- years must not be dropped for a Chromebook borrowed once last term.
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every read is "this player's devices", and the cap eviction wants them in
-- staleness order, so the index carries both.
CREATE INDEX IF NOT EXISTS push_subscriptions_player_idx
  ON push_subscriptions (player_id, last_seen_at DESC);

COMMIT;
