-- HallPass — migration: the `mcp` schema, a PII-stripped view of everything.
--
-- See `app/lib/mcp/analytics/schema.sql` for the canonical fresh-install DDL;
-- keep the two in lockstep. `analytics-mcp-design.md` §4 is the full argument.
--
-- ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
-- The analytics MCP's `run_analytics_sql` tool lets a language model write its
-- own SELECT. The ask was that it see every table, with the personal columns
-- taken out. These views are the "with the personal columns taken out" half.
--
-- ── A VIEW IS NOT A PERMISSION ─────────────────────────────────────────────
-- Stated first because it is the mistake this file exists to avoid. A
-- connection holding the app's own role can `SELECT email FROM public.players`
-- no matter how many careful views sit beside it. What makes this a boundary is
-- the SEPARATE POSTGRES ROLE in `scripts/provision-mcp-reader.mjs`: it is
-- granted USAGE on this schema and SELECT on these views, and nothing at all on
-- `public`. The views shape the data; the role is what stops the raw tables
-- being read around them.
--
-- ── THEREFORE: DO NOT SET `security_invoker` ON THESE VIEWS ────────────────
-- Postgres defaults to checking a view's permissions as its OWNER, and that
-- default is the entire mechanism: it is what lets a role with no privileges on
-- `public` read through to `public.players`. Turning on `security_invoker`
-- would make every one of these views fail for the only role meant to use them.
--
-- ── THE COLUMN POLICY ──────────────────────────────────────────────────────
-- NEVER exposed, anywhere below:
--   * `players.email`, `players.name`, `players.image` — a child's address,
--     real name and photograph. `players.username` and `players.handle` ARE
--     exposed: both are self-chosen and both are already printed on public
--     leaderboards.
--   * `players.id` — the Google subject identifier. An id from somebody else's
--     identity system is not ours to hand out.
--   * `players.friend_code` and `challenges.code` — live invite tokens. Anyone
--     holding one can act on it.
--   * `dashboard_users`, `push_subscriptions`, `player_blocks`, `review_bans`,
--     `review_moderation_log`, `beta_shots`, `beta_invite_requests`,
--     `username_history`, `friend_request_attempts` and the `mcp_oauth_*`
--     tables — no view at all. Administrator identities, endpoint secrets,
--     moderation judgements about named children, and this feature's own
--     credentials.
--   * every `*_blob_path` / `*_url` on beta evidence — screenshots and screen
--     recordings taken on children's devices.
--   * `ip_hash`, `body_hash` — pseudonyms whose only use is re-identification.
--   * free-text written ABOUT a person (`beta_testers.notes`,
--     `beta_assignments.brief`) and free text long enough to flood a model's
--     context (`tracker_items.brief`, up to 20,000 characters).
--   * `beta_reports.title` / `.body` / `.error_log` — a child's own words and
--     their game's stack traces. The metadata (kind, severity, status, error
--     COUNT) is what an analytics question needs; the prose is what the bug
--     tools are for, behind the other credential.
--
-- The join key everywhere is `players.public_id`, which is already the
-- identifier this app puts on the wire.
--
-- ── WHY THE JOINS ARE ALL `LEFT` ───────────────────────────────────────────
-- `scores.player_id` is nullable (an anonymous score is still a score) and
-- several others are `ON DELETE SET NULL`. An INNER join would silently drop
-- exactly the rows that make a total disagree with the dashboard's — and a
-- number that is quietly too low is worse than no number.
--
-- Fully idempotent — every statement guarded, whole file in one transaction.

BEGIN;

CREATE SCHEMA IF NOT EXISTS mcp;

-- ── Identity ───────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS mcp.players CASCADE;
CREATE VIEW mcp.players AS
  SELECT public_id            AS player_public_id,
         username,
         handle,
         -- Whether the player finished the naming step, without exposing which
         -- name they chose beyond the two public ones above.
         (username IS NOT NULL) AS has_username,
         profile_visibility,
         created_at,
         last_login
  FROM public.players;

-- ── Leaderboards ───────────────────────────────────────────────────────────

DROP VIEW IF EXISTS mcp.boards CASCADE;
CREATE VIEW mcp.boards AS
  SELECT id, game_slug, title, sort, score_label, max_score, created_at, updated_at
  FROM public.boards;

DROP VIEW IF EXISTS mcp.scores CASCADE;
CREATE VIEW mcp.scores AS
  SELECT s.id,
         s.board_id,
         p.public_id AS player_public_id,
         -- The handle printed on the public board. NULL player_id means an
         -- anonymous score, and the handle is all there is.
         s.handle,
         s.score,
         s.created_at
  FROM public.scores s
  LEFT JOIN public.players p ON p.id = s.player_id;

-- ── Catalogue ──────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS mcp.game_overrides CASCADE;
CREATE VIEW mcp.game_overrides AS
  SELECT slug, title, tagline, description, category, tags, is_new, is_featured,
         platform, updated_at
  FROM public.game_overrides;

DROP VIEW IF EXISTS mcp.external_games CASCADE;
CREATE VIEW mcp.external_games AS
  SELECT slug, title, tagline, description, category, tags, external_url,
         is_new, is_featured, plays, platform, created_at, updated_at
  FROM public.external_games;

DROP VIEW IF EXISTS mcp.game_media CASCADE;
CREATE VIEW mcp.game_media AS
  SELECT id, slug, kind, content_type, width, height, bytes, alt, position,
         created_at, updated_at
  FROM public.game_media;

DROP VIEW IF EXISTS mcp.game_videos CASCADE;
CREATE VIEW mcp.game_videos AS
  SELECT slug, youtube_id, label, created_at, updated_at
  FROM public.game_videos;

DROP VIEW IF EXISTS mcp.game_credits CASCADE;
CREATE VIEW mcp.game_credits AS
  SELECT slug, uploader_name, first_uploaded_at, updated_at
  FROM public.game_credits;

DROP VIEW IF EXISTS mcp.game_blobs CASCADE;
CREATE VIEW mcp.game_blobs AS
  SELECT pathname, slug, size, uploaded_at
  FROM public.game_blobs;

-- ── Play and preference ────────────────────────────────────────────────────

DROP VIEW IF EXISTS mcp.player_plays CASCADE;
CREATE VIEW mcp.player_plays AS
  SELECT p.public_id AS player_public_id,
         pp.slug, pp.play_count, pp.first_played, pp.last_played
  FROM public.player_plays pp
  LEFT JOIN public.players p ON p.id = pp.player_id;

DROP VIEW IF EXISTS mcp.player_favorites CASCADE;
CREATE VIEW mcp.player_favorites AS
  SELECT p.public_id AS player_public_id, f.slug, f.created_at
  FROM public.player_favorites f
  LEFT JOIN public.players p ON p.id = f.player_id;

-- ── Reviews ────────────────────────────────────────────────────────────────
-- `body` IS exposed: a visible review is public site content, shown to every
-- visitor on the game's page. The hashes beside it are not.

DROP VIEW IF EXISTS mcp.game_reviews CASCADE;
CREATE VIEW mcp.game_reviews AS
  SELECT r.id, r.slug,
         p.public_id AS player_public_id,
         r.recommended, r.body, r.status, r.helpful_count, r.report_count,
         r.created_at, r.updated_at, r.status_changed_at
  FROM public.game_reviews r
  LEFT JOIN public.players p ON p.id = r.player_id;

-- Who reported a comment is a moderation fact about two named children and
-- carries no analytic weight the counts do not already carry, so the reporter
-- is dropped and only the shape of the queue survives.
DROP VIEW IF EXISTS mcp.review_reports CASCADE;
CREATE VIEW mcp.review_reports AS
  SELECT id, review_id, reason, status, created_at, resolved_at
  FROM public.review_reports;

DROP VIEW IF EXISTS mcp.review_helpful CASCADE;
CREATE VIEW mcp.review_helpful AS
  SELECT rh.review_id, p.public_id AS player_public_id, rh.created_at
  FROM public.review_helpful rh
  LEFT JOIN public.players p ON p.id = rh.player_id;

-- ── Social ─────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS mcp.friendships CASCADE;
CREATE VIEW mcp.friendships AS
  SELECT a.public_id AS player_a_public_id,
         b.public_id AS player_b_public_id,
         f.status, f.created_at, f.responded_at
  FROM public.friendships f
  LEFT JOIN public.players a ON a.id = f.player_a
  LEFT JOIN public.players b ON b.id = f.player_b;

-- ── Achievements ───────────────────────────────────────────────────────────

DROP VIEW IF EXISTS mcp.achievements CASCADE;
CREATE VIEW mcp.achievements AS
  SELECT id, slug, key, name, description, icon, points, target, secret,
         position, created_at, updated_at
  FROM public.achievements;

DROP VIEW IF EXISTS mcp.player_achievements CASCADE;
CREATE VIEW mcp.player_achievements AS
  SELECT p.public_id AS player_public_id,
         pa.achievement_id, pa.progress, pa.unlocked_at, pa.created_at, pa.updated_at
  FROM public.player_achievements pa
  LEFT JOIN public.players p ON p.id = pa.player_id;

-- ── Challenges ─────────────────────────────────────────────────────────────
-- `code` is omitted and that omission is load-bearing: a link challenge's code
-- is a bearer token, and anybody holding one can claim the challenge.

DROP VIEW IF EXISTS mcp.challenges CASCADE;
CREATE VIEW mcp.challenges AS
  SELECT c.id, c.kind, c.board_id,
         ch.public_id AS challenger_public_id,
         tg.public_id AS target_public_id,
         c.target_score, c.created_at, c.accepted_at, c.resolved_at,
         c.resolved_score, c.dismissed_at, c.starts_at, c.ends_at,
         c.parent_id, c.revoked_at, c.opens
  FROM public.challenges c
  LEFT JOIN public.players ch ON ch.id = c.challenger_id
  LEFT JOIN public.players tg ON tg.id = c.target_id;

-- ── Beta programme ─────────────────────────────────────────────────────────
-- Metadata only. The prose, the screenshots and the replay clips stay behind
-- the bug tools, which are reachable only with MCP_SECRET.

DROP VIEW IF EXISTS mcp.beta_reports CASCADE;
CREATE VIEW mcp.beta_reports AS
  SELECT r.id,
         p.public_id AS player_public_id,
         r.assignment_id, r.slug, r.kind, r.severity, r.status,
         r.error_count,
         (r.clip_blob_path IS NOT NULL OR r.clip_url IS NOT NULL) AS has_clip,
         (r.shot_blob_path IS NOT NULL OR r.shot_url IS NOT NULL) AS has_screenshot,
         r.clip_ms,
         -- The user-agent string. Not identifying on its own, and it is the
         -- answer to "which devices produce the bugs".
         r.device,
         r.created_at, r.resolved_at
  FROM public.beta_reports r
  LEFT JOIN public.players p ON p.id = r.player_id;

DROP VIEW IF EXISTS mcp.beta_assignments CASCADE;
CREATE VIEW mcp.beta_assignments AS
  SELECT a.id, p.public_id AS player_public_id,
         a.slug, a.status, a.created_at, a.updated_at, a.completed_at
  FROM public.beta_assignments a
  LEFT JOIN public.players p ON p.id = a.player_id;

DROP VIEW IF EXISTS mcp.beta_testers CASCADE;
CREATE VIEW mcp.beta_testers AS
  SELECT p.public_id AS player_public_id, t.invited_at, t.revoked_at
  FROM public.beta_testers t
  LEFT JOIN public.players p ON p.id = t.player_id;

DROP VIEW IF EXISTS mcp.beta_xp_awards CASCADE;
CREATE VIEW mcp.beta_xp_awards AS
  SELECT x.id, p.public_id AS player_public_id,
         x.amount, x.reason, x.report_id, x.shot_id, x.created_at
  FROM public.beta_xp_awards x
  LEFT JOIN public.players p ON p.id = x.player_id;

-- ── Internal work tracking ─────────────────────────────────────────────────
-- `brief` is omitted for size, not for secrecy: up to 20,000 characters per
-- row, and a model that SELECTs the table to count lanes should not pay for it.

DROP VIEW IF EXISTS mcp.tracker_items CASCADE;
CREATE VIEW mcp.tracker_items AS
  SELECT id, title, status, position, created_at, updated_at, started_at,
         done_at, archived_at, gh_repo, gh_issue_number
  FROM public.tracker_items;

DROP VIEW IF EXISTS mcp.tracker_item_tags CASCADE;
CREATE VIEW mcp.tracker_item_tags AS
  SELECT item_id, tag FROM public.tracker_item_tags;

-- ── Notifications ──────────────────────────────────────────────────────────
-- Kind and timing only. A notification's title and body routinely name a child
-- ("Ada challenged you on Duskfall"), and the analytic question is how many of
-- each kind were sent, not what any one of them said.

DROP VIEW IF EXISTS mcp.notifications CASCADE;
CREATE VIEW mcp.notifications AS
  SELECT id, kind, (player_id IS NULL) AS is_broadcast, created_at
  FROM public.notifications;

-- ── Operational ────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS mcp.app_settings CASCADE;
CREATE VIEW mcp.app_settings AS
  SELECT key, value, updated_at FROM public.app_settings;

DROP VIEW IF EXISTS mcp.schema_migrations CASCADE;
CREATE VIEW mcp.schema_migrations AS
  SELECT filename, applied_at FROM public.schema_migrations;

-- The MCP's own activity feed — what an agent said it was doing, which is a
-- legitimate thing to ask analytic questions about.
DROP VIEW IF EXISTS mcp.agent_activity CASCADE;
CREATE VIEW mcp.agent_activity AS
  SELECT id, actor, tool, outcome, report_id, slug, summary, created_at
  FROM public.beta_agent_activity;

COMMIT;
