/**
 * HallPass — the survey store.
 *
 * A `createSurveyStore(sql)` factory, like `tracker/store.ts`: it takes the
 * tagged-template function so the module stays free of `server-only` and
 * `store.test.ts` can assert the SHAPE of every statement against a fake.
 *
 * ── ONE STATEMENT PER MUTATION, forced by the driver ───────────────────────
 * `neon()` is SQL-over-HTTP: one stateless request per tagged template, so two
 * `await`s are not a transaction. Every write below is therefore a single
 * multi-CTE statement, and the tests assert the call count. The one exception is
 * {@link updateQuestion}, which READS the question first to decide the new
 * option ids and then writes in one statement; the write re-checks everything
 * the read decided, so a race costs an edit, never a corrupt answer.
 *
 * ── THE EMPTY RESULT SET IS THE OUTCOME CODE ──────────────────────────────
 * As in the tracker, a guard that fails (no such survey, archived, full) yields
 * zero rows and the method returns `null`/`false`, which is how an action tells
 * a refusal from success without a second round trip.
 *
 * ── ANSWERED QUESTIONS ARE RETIRED, NEVER REWRITTEN ───────────────────────
 * `037_surveys.sql` has the argument. In short: editing the wording or options
 * of a question that already has answers would change what those answers mean,
 * so {@link updateQuestion} forks it (retire the old row, insert a replacement at
 * the same position) and {@link removeQuestion} retires instead of deleting.
 * Results read retired rows by their own wording.
 *
 * ── NOTHING HERE RETURNS WHO ANSWERED ─────────────────────────────────────
 * Results carry a response number and a timestamp, never a player id or email.
 * The data leaves the site to MCP clients (ChatGPT among them), and a survey
 * about what to build next does not need to know who said it.
 *
 * ── SQL SAFETY ────────────────────────────────────────────────────────────
 * The tagged template parameterises values only. Nothing interpolates a
 * fragment. Lists cross the boundary as one JSON document (`jsonb_to_recordset`)
 * or comma-joined text of ids that cannot contain a comma.
 */

import type { NeonQueryFunction } from "@neondatabase/serverless";
import {
  QUESTIONS_MAX,
  assignOptionIds,
  toOptions,
  type QuestionKind,
  type SurveyOption,
  type SurveyStatus,
} from "./config";
import type { ValidAnswer } from "./validate";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

/** `BIGINT` arrives from the HTTP driver as a string. */
function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toIso(value: unknown): string {
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  return value == null ? null : toIso(value);
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type SurveySummary = {
  id: number;
  slug: string;
  title: string;
  status: SurveyStatus;
  closesAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Live (non-retired) questions. */
  questionCount: number;
  responseCount: number;
};

export type SurveyQuestion = {
  id: number;
  surveyId: number;
  position: number;
  kind: QuestionKind;
  prompt: string;
  required: boolean;
  options: SurveyOption[];
  /** Set once the question has been replaced or removed after being answered. */
  retired: boolean;
  /** How many answers it holds; non-zero means an edit forks it. */
  answerCount: number;
};

export type SurveyDetail = SurveySummary & {
  intro: string;
  archivedAt: string | null;
  questions: SurveyQuestion[];
};

/** What a player is shown: no counts, no authorship, only live questions. */
export type PublicSurvey = {
  id: number;
  slug: string;
  title: string;
  intro: string;
  closesAt: string | null;
  questions: Array<Pick<SurveyQuestion, "id" | "kind" | "prompt" | "required" | "options">>;
  /** Whether the asking player has already answered. */
  answered: boolean;
};

export type SubmitOutcome = "ok" | "closed" | "duplicate" | "stale";

export type QuestionResult = {
  question: SurveyQuestion;
  /** Responses that answered THIS question. */
  answered: number;
  /** Choice questions: how many picked each option id. */
  choices: Array<{ optionId: string; label: string; count: number }>;
  /** Scale questions: how many gave each value 1-5, and the mean. */
  scale: { counts: Record<number, number>; mean: number | null } | null;
  /** Text questions: the newest answers, with no author. */
  texts: Array<{ responseId: number; body: string; createdAt: string }>;
};

export type SurveyResults = {
  survey: SurveySummary;
  responseCount: number;
  questions: QuestionResult[];
};

/** How many free-text answers one question returns, newest first. */
export const TEXT_RESULT_LIMIT = 200;

export function createSurveyStore(sql: Sql) {
  function mapSummary(row: Row): SurveySummary {
    return {
      id: toInt(row.id),
      slug: String(row.slug),
      title: String(row.title),
      status: String(row.status) as SurveyStatus,
      closesAt: toIsoOrNull(row.closes_at),
      createdBy: String(row.created_by),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
      questionCount: toInt(row.question_count),
      responseCount: toInt(row.response_count),
    };
  }

  function mapQuestion(row: Row): SurveyQuestion {
    return {
      id: toInt(row.id),
      surveyId: toInt(row.survey_id),
      position: toInt(row.position),
      kind: String(row.kind) as QuestionKind,
      prompt: String(row.prompt),
      required: Boolean(row.required),
      options: toOptions(row.options),
      retired: row.retired_at != null,
      answerCount: toInt(row.answer_count),
    };
  }

  /** Columns every survey read selects, with the two counts. */
  async function selectSurveys(where: "all" | "id" | "slug", key?: number | string) {
    // Three literal templates rather than a spliced WHERE: see SQL SAFETY above.
    if (where === "id") {
      return (await sql`
        SELECT s.*,
               (SELECT count(*) FROM survey_questions q
                 WHERE q.survey_id = s.id AND q.retired_at IS NULL) AS question_count,
               (SELECT count(*) FROM survey_responses r WHERE r.survey_id = s.id) AS response_count
          FROM surveys s
         WHERE s.id = ${key as number}
      `) as Row[];
    }
    if (where === "slug") {
      return (await sql`
        SELECT s.*,
               (SELECT count(*) FROM survey_questions q
                 WHERE q.survey_id = s.id AND q.retired_at IS NULL) AS question_count,
               (SELECT count(*) FROM survey_responses r WHERE r.survey_id = s.id) AS response_count
          FROM surveys s
         WHERE s.slug = ${key as string}
      `) as Row[];
    }
    return (await sql`
      SELECT s.*,
             (SELECT count(*) FROM survey_questions q
               WHERE q.survey_id = s.id AND q.retired_at IS NULL) AS question_count,
             (SELECT count(*) FROM survey_responses r WHERE r.survey_id = s.id) AS response_count
        FROM surveys s
       WHERE s.archived_at IS NULL
       ORDER BY CASE s.status WHEN 'live' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, s.id DESC
    `) as Row[];
  }

  async function selectQuestions(surveyId: number): Promise<SurveyQuestion[]> {
    const rows = (await sql`
      SELECT q.*,
             (SELECT count(*) FROM survey_answers a WHERE a.question_id = q.id) AS answer_count
        FROM survey_questions q
       WHERE q.survey_id = ${surveyId}
       ORDER BY q.retired_at IS NOT NULL, q.position, q.id
    `) as Row[];
    return rows.map(mapQuestion);
  }

  async function selectQuestion(id: number): Promise<SurveyQuestion | null> {
    const rows = (await sql`
      SELECT q.*,
             (SELECT count(*) FROM survey_answers a WHERE a.question_id = q.id) AS answer_count
        FROM survey_questions q
       WHERE q.id = ${id}
    `) as Row[];
    return rows.length ? mapQuestion(rows[0]) : null;
  }

  return {
    // -----------------------------------------------------------------------
    // Reads (admin)
    // -----------------------------------------------------------------------

    /** Every non-archived survey: live first, then drafts, then closed. */
    async listSurveys(): Promise<SurveySummary[]> {
      return (await selectSurveys("all")).map(mapSummary);
    },

    /** One survey with every question (retired ones last), or `null`. */
    async getSurvey(id: number): Promise<SurveyDetail | null> {
      const rows = await selectSurveys("id", id);
      if (!rows.length) return null;
      return {
        ...mapSummary(rows[0]),
        intro: String(rows[0].intro ?? ""),
        archivedAt: toIsoOrNull(rows[0].archived_at),
        questions: await selectQuestions(toInt(rows[0].id)),
      };
    },

    /** One question by id (live or retired), or `null`. */
    getQuestion: selectQuestion,

    // -----------------------------------------------------------------------
    // Writes (admin)
    // -----------------------------------------------------------------------

    /**
     * Create a draft. Returns the new id, or `null` when the slug is taken
     * (including by an archived survey — a slug is a public URL and is not
     * recycled out from under a link that was shared).
     */
    async createSurvey(input: {
      slug: string;
      title: string;
      intro: string;
      actor: string;
    }): Promise<number | null> {
      const rows = (await sql`
        INSERT INTO surveys (slug, title, intro, created_by)
        VALUES (${input.slug}, ${input.title}, ${input.intro}, ${input.actor})
        ON CONFLICT (slug) DO NOTHING
        RETURNING id
      `) as Row[];
      return rows.length ? toInt(rows[0].id) : null;
    },

    /** Change the title, intro and close time. `false` if missing or archived. */
    async updateSurvey(
      id: number,
      input: { title: string; intro: string; closesAt: string | null },
    ): Promise<boolean> {
      const rows = (await sql`
        UPDATE surveys
           SET title = ${input.title},
               intro = ${input.intro},
               closes_at = ${input.closesAt}::timestamptz,
               updated_at = now()
         WHERE id = ${id} AND archived_at IS NULL
        RETURNING id
      `) as Row[];
      return rows.length > 0;
    },

    /**
     * Move a survey between draft, live and closed.
     *
     * Going live needs at least one live question: a survey with nothing to
     * answer would put an empty banner in front of every player. The guard is in
     * the SQL so it holds for the dashboard and the MCP alike.
     *
     * Re-selecting the current status is a no-op rather than a failure, for the
     * reason `tracker.setStatus` gives: a double-submitted form must not read as
     * "no such survey". Returns `null` only when there is no live row to move.
     */
    async setStatus(
      id: number,
      next: SurveyStatus,
    ): Promise<{ from: SurveyStatus; changed: boolean; blocked: boolean } | null> {
      const rows = (await sql`
        WITH prev AS (
          SELECT s.id, s.status,
                 (SELECT count(*) FROM survey_questions q
                   WHERE q.survey_id = s.id AND q.retired_at IS NULL) AS qn
            FROM surveys s
           WHERE s.id = ${id} AND s.archived_at IS NULL
        ), moved AS (
          UPDATE surveys s
             SET status = ${next}::text, updated_at = now()
            FROM prev
           WHERE s.id = prev.id
             AND prev.status <> ${next}::text
             AND (${next}::text <> 'live' OR prev.qn > 0)
          RETURNING s.id
        )
        SELECT prev.status AS from_status, prev.qn, (moved.id IS NOT NULL) AS changed
          FROM prev LEFT JOIN moved ON true
      `) as Row[];
      if (!rows.length) return null;
      const from = String(rows[0].from_status) as SurveyStatus;
      const changed = Boolean(rows[0].changed);
      return {
        from,
        changed,
        blocked: !changed && from !== next && next === "live" && toInt(rows[0].qn) === 0,
      };
    },

    /** Hide a survey from the list and the public site. Answers are kept. */
    async archiveSurvey(id: number): Promise<boolean> {
      const rows = (await sql`
        UPDATE surveys
           SET archived_at = now(), updated_at = now(),
               status = CASE WHEN status = 'live' THEN 'closed' ELSE status END
         WHERE id = ${id} AND archived_at IS NULL
        RETURNING id
      `) as Row[];
      return rows.length > 0;
    },

    /**
     * Append a question to the end. Returns its id, or `null` when the survey is
     * missing/archived or already holds {@link QUESTIONS_MAX} live questions.
     */
    async addQuestion(input: {
      surveyId: number;
      kind: QuestionKind;
      prompt: string;
      required: boolean;
      optionLabels: readonly string[];
    }): Promise<number | null> {
      const options = JSON.stringify(assignOptionIds(input.optionLabels));
      const rows = (await sql`
        WITH live AS (
          SELECT s.id,
                 (SELECT count(*) FROM survey_questions q
                   WHERE q.survey_id = s.id AND q.retired_at IS NULL) AS qn,
                 (SELECT coalesce(max(q.position), -1) + 1 FROM survey_questions q
                   WHERE q.survey_id = s.id AND q.retired_at IS NULL) AS next_position
            FROM surveys s
           WHERE s.id = ${input.surveyId} AND s.archived_at IS NULL
        ), ins AS (
          INSERT INTO survey_questions (survey_id, position, kind, prompt, required, options)
          SELECT live.id, live.next_position, ${input.kind}, ${input.prompt},
                 ${input.required}, ${options}::jsonb
            FROM live
           WHERE live.qn < ${QUESTIONS_MAX}
          RETURNING id
        ), touched AS (
          UPDATE surveys SET updated_at = now()
           WHERE id = ${input.surveyId} AND EXISTS (SELECT 1 FROM ins)
          RETURNING id
        )
        SELECT id FROM ins
      `) as Row[];
      return rows.length ? toInt(rows[0].id) : null;
    },

    /**
     * Change a question's prompt, required flag and/or options. The KIND never
     * changes — turning a rating into free text would reinterpret its answers —
     * so to change kind, remove the question and add another.
     *
     * An unanswered question is updated in place. An answered one is forked: the
     * old row is retired and a replacement is inserted at the same position, so
     * every earlier answer keeps the wording it was given under.
     *
     * Returns `{ id, forked }` — `id` is the question to use from now on — or
     * `null` if it is missing, already retired, or its survey is archived.
     */
    async updateQuestion(
      questionId: number,
      patch: { prompt?: string; required?: boolean; optionLabels?: readonly string[] },
    ): Promise<{ id: number; forked: boolean } | null> {
      const current = await selectQuestion(questionId);
      if (!current || current.retired) return null;

      const prompt = patch.prompt ?? current.prompt;
      const required = patch.required ?? current.required;
      const options = JSON.stringify(
        patch.optionLabels
          ? assignOptionIds(patch.optionLabels, current.options)
          : current.options,
      );

      const rows = (await sql`
        WITH prev AS (
          SELECT q.id, q.survey_id, q.position, q.kind,
                 EXISTS (SELECT 1 FROM survey_answers a WHERE a.question_id = q.id) AS answered
            FROM survey_questions q
            JOIN surveys s ON s.id = q.survey_id
           WHERE q.id = ${questionId} AND q.retired_at IS NULL AND s.archived_at IS NULL
        ), edited AS (
          UPDATE survey_questions q
             SET prompt = ${prompt}, required = ${required}, options = ${options}::jsonb
            FROM prev
           WHERE q.id = prev.id AND NOT prev.answered
          RETURNING q.id
        ), retired AS (
          UPDATE survey_questions q SET retired_at = now()
            FROM prev
           WHERE q.id = prev.id AND prev.answered
          RETURNING q.id
        ), replaced AS (
          INSERT INTO survey_questions (survey_id, position, kind, prompt, required, options)
          SELECT prev.survey_id, prev.position, prev.kind, ${prompt}, ${required}, ${options}::jsonb
            FROM prev WHERE prev.answered
          RETURNING id
        ), touched AS (
          UPDATE surveys SET updated_at = now()
           WHERE id = (SELECT survey_id FROM prev)
          RETURNING id
        )
        SELECT coalesce((SELECT id FROM replaced), (SELECT id FROM edited)) AS id,
               (SELECT answered FROM prev) AS forked
          FROM prev
      `) as Row[];
      if (!rows.length || rows[0].id == null) return null;
      return { id: toInt(rows[0].id), forked: Boolean(rows[0].forked) };
    },

    /**
     * Remove a question: deleted outright if nobody answered it, retired if
     * anybody did (so results still show it). `null` if missing or already gone.
     */
    async removeQuestion(questionId: number): Promise<"deleted" | "retired" | null> {
      const rows = (await sql`
        WITH prev AS (
          SELECT q.id,
                 EXISTS (SELECT 1 FROM survey_answers a WHERE a.question_id = q.id) AS answered
            FROM survey_questions q
            JOIN surveys s ON s.id = q.survey_id
           WHERE q.id = ${questionId} AND q.retired_at IS NULL AND s.archived_at IS NULL
        ), deleted AS (
          DELETE FROM survey_questions q USING prev
           WHERE q.id = prev.id AND NOT prev.answered
          RETURNING q.id
        ), retired AS (
          UPDATE survey_questions q SET retired_at = now()
            FROM prev
           WHERE q.id = prev.id AND prev.answered
          RETURNING q.id
        )
        SELECT (SELECT answered FROM prev) AS answered FROM prev
      `) as Row[];
      if (!rows.length) return null;
      return rows[0].answered ? "retired" : "deleted";
    },

    /**
     * Swap a live question with its neighbour. `false` when there is no
     * neighbour that way (already first/last) or the question is gone.
     */
    async moveQuestion(questionId: number, direction: "up" | "down"): Promise<boolean> {
      const rows = (await sql`
        WITH me AS (
          SELECT id, survey_id, position FROM survey_questions
           WHERE id = ${questionId} AND retired_at IS NULL
        ), nb AS (
          SELECT q.id, q.position
            FROM survey_questions q, me
           WHERE q.survey_id = me.survey_id AND q.retired_at IS NULL
             AND ((${direction}::text = 'up' AND q.position < me.position)
               OR (${direction}::text = 'down' AND q.position > me.position))
           ORDER BY CASE WHEN ${direction}::text = 'up' THEN -q.position ELSE q.position END
           LIMIT 1
        ), a AS (
          UPDATE survey_questions SET position = (SELECT position FROM nb)
           WHERE id = (SELECT id FROM me) AND EXISTS (SELECT 1 FROM nb)
          RETURNING id
        ), b AS (
          UPDATE survey_questions SET position = (SELECT position FROM me)
           WHERE id = (SELECT id FROM nb)
          RETURNING id
        )
        SELECT (SELECT count(*) FROM a) AS moved
      `) as Row[];
      return rows.length > 0 && toInt(rows[0].moved) > 0;
    },

    // -----------------------------------------------------------------------
    // Players
    // -----------------------------------------------------------------------

    /**
     * A live survey by slug, with its live questions, as a player sees it.
     * `null` for a draft, closed, archived or expired survey — all look the same
     * from outside, on purpose. `playerId` only fills `answered`.
     */
    async getPublicSurvey(slug: string, playerId: string | null): Promise<PublicSurvey | null> {
      const rows = (await sql`
        SELECT s.id, s.slug, s.title, s.intro, s.closes_at,
               EXISTS (SELECT 1 FROM survey_responses r
                        WHERE r.survey_id = s.id AND r.player_id = ${playerId}) AS answered
          FROM surveys s
         WHERE s.slug = ${slug} AND s.status = 'live' AND s.archived_at IS NULL
           AND (s.closes_at IS NULL OR s.closes_at > now())
      `) as Row[];
      if (!rows.length) return null;
      const id = toInt(rows[0].id);
      const questions = (await sql`
        SELECT id, kind, prompt, required, options
          FROM survey_questions
         WHERE survey_id = ${id} AND retired_at IS NULL
         ORDER BY position, id
      `) as Row[];
      return {
        id,
        slug: String(rows[0].slug),
        title: String(rows[0].title),
        intro: String(rows[0].intro ?? ""),
        closesAt: toIsoOrNull(rows[0].closes_at),
        answered: Boolean(rows[0].answered),
        questions: questions.map((q) => ({
          id: toInt(q.id),
          kind: String(q.kind) as QuestionKind,
          prompt: String(q.prompt),
          required: Boolean(q.required),
          options: toOptions(q.options),
        })),
      };
    },

    /**
     * The newest live survey, for the site banner, and whether this player has
     * answered it. One row, no questions. `null` if nothing is live.
     */
    async getBannerSurvey(
      playerId: string | null,
    ): Promise<{ slug: string; title: string; answered: boolean } | null> {
      const rows = (await sql`
        SELECT s.slug, s.title,
               EXISTS (SELECT 1 FROM survey_responses r
                        WHERE r.survey_id = s.id AND r.player_id = ${playerId}) AS answered
          FROM surveys s
         WHERE s.status = 'live' AND s.archived_at IS NULL
           AND (s.closes_at IS NULL OR s.closes_at > now())
           AND EXISTS (SELECT 1 FROM survey_questions q
                        WHERE q.survey_id = s.id AND q.retired_at IS NULL)
         ORDER BY s.id DESC
         LIMIT 1
      `) as Row[];
      if (!rows.length) return null;
      return {
        slug: String(rows[0].slug),
        title: String(rows[0].title),
        answered: Boolean(rows[0].answered),
      };
    },

    /**
     * Record one player's answers.
     *
     * One statement. The response row is only inserted if the survey is open AND
     * every answered question is still a live question of that survey, so a form
     * that went stale mid-edit writes nothing rather than a partial response.
     * The `UNIQUE (survey_id, player_id)` constraint makes the second submit a
     * conflict however the race falls.
     *
     * Outcomes: `ok`; `closed` (not live, expired, archived or missing);
     * `duplicate` (already answered); `stale` (a question was retired).
     */
    async submitResponse(input: {
      surveyId: number;
      playerId: string;
      answers: readonly ValidAnswer[];
    }): Promise<SubmitOutcome> {
      const payload = JSON.stringify(
        input.answers.map((a) => ({
          question_id: a.questionId,
          choice_ids: a.choiceIds ? a.choiceIds.join(",") : null,
          scale: a.scale,
          body: a.body,
        })),
      );
      const rows = (await sql`
        WITH live_survey AS (
          SELECT s.id FROM surveys s
           WHERE s.id = ${input.surveyId} AND s.status = 'live' AND s.archived_at IS NULL
             AND (s.closes_at IS NULL OR s.closes_at > now())
        ), fresh AS (
          SELECT live_survey.id FROM live_survey
           WHERE NOT EXISTS (
             SELECT 1
               FROM jsonb_to_recordset(${payload}::jsonb) AS a(question_id bigint)
              WHERE NOT EXISTS (
                SELECT 1 FROM survey_questions q
                 WHERE q.id = a.question_id AND q.survey_id = live_survey.id AND q.retired_at IS NULL)
           )
        ), resp AS (
          INSERT INTO survey_responses (survey_id, player_id)
          SELECT fresh.id, ${input.playerId} FROM fresh
          ON CONFLICT ON CONSTRAINT survey_responses_one_per_player DO NOTHING
          RETURNING id
        ), ins AS (
          INSERT INTO survey_answers (response_id, question_id, choice_ids, scale, body)
          SELECT resp.id, a.question_id,
                 string_to_array(a.choice_ids, ','), a.scale::smallint, a.body
            FROM resp,
                 jsonb_to_recordset(${payload}::jsonb)
                   AS a(question_id bigint, choice_ids text, scale int, body text)
          RETURNING response_id
        )
        SELECT (SELECT count(*) FROM live_survey) AS is_open,
               (SELECT count(*) FROM fresh) AS is_fresh,
               (SELECT count(*) FROM resp)  AS created
      `) as Row[];
      const row = rows[0] ?? {};
      if (toInt(row.created) > 0) return "ok";
      if (!toInt(row.is_open)) return "closed";
      if (!toInt(row.is_fresh)) return "stale";
      return "duplicate";
    },

    // -----------------------------------------------------------------------
    // Results
    // -----------------------------------------------------------------------

    /**
     * Aggregate results for one survey, including retired questions (their
     * answers are real). Four reads, run together; none returns a player.
     */
    async getResults(id: number): Promise<SurveyResults | null> {
      const surveyRows = await selectSurveys("id", id);
      if (!surveyRows.length) return null;

      const [questions, choiceRows, scaleRows, textRows] = await Promise.all([
        selectQuestions(id),
        sql`
          SELECT a.question_id, c AS option_id, count(*) AS n
            FROM survey_answers a
            JOIN survey_questions q ON q.id = a.question_id,
                 unnest(a.choice_ids) AS c
           WHERE q.survey_id = ${id}
           GROUP BY a.question_id, c
        ` as unknown as Promise<Row[]>,
        sql`
          SELECT a.question_id, a.scale, count(*) AS n
            FROM survey_answers a
            JOIN survey_questions q ON q.id = a.question_id
           WHERE q.survey_id = ${id} AND a.scale IS NOT NULL
           GROUP BY a.question_id, a.scale
        ` as unknown as Promise<Row[]>,
        sql`
          SELECT t.question_id, t.response_id, t.body, t.created_at
            FROM (
              SELECT a.question_id, a.response_id, a.body, r.created_at,
                     row_number() OVER (
                       PARTITION BY a.question_id
                       ORDER BY r.created_at DESC, a.response_id DESC) AS rn
                FROM survey_answers a
                JOIN survey_questions q ON q.id = a.question_id
                JOIN survey_responses r ON r.id = a.response_id
               WHERE q.survey_id = ${id} AND a.body IS NOT NULL
            ) t
           WHERE t.rn <= ${TEXT_RESULT_LIMIT}
           ORDER BY t.question_id, t.rn
        ` as unknown as Promise<Row[]>,
      ]);

      const results: QuestionResult[] = questions.map((question) => {
        const picks = choiceRows.filter((r) => toInt(r.question_id) === question.id);
        const scales = scaleRows.filter((r) => toInt(r.question_id) === question.id);
        const texts = textRows
          .filter((r) => toInt(r.question_id) === question.id)
                    .map((r) => ({
            responseId: toInt(r.response_id),
            body: String(r.body),
            createdAt: toIso(r.created_at),
          }));

        let scale: QuestionResult["scale"] = null;
        if (question.kind === "scale") {
          const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
          let total = 0;
          let sum = 0;
          for (const r of scales) {
            const value = toInt(r.scale);
            const n = toInt(r.n);
            counts[value] = n;
            total += n;
            sum += value * n;
          }
          scale = { counts, mean: total ? sum / total : null };
        }

        const choices =
          question.kind === "single" || question.kind === "multi"
            ? question.options.map((option) => ({
                optionId: option.id,
                label: option.label,
                count: toInt(picks.find((p) => String(p.option_id) === option.id)?.n),
              }))
            : [];

        // One row per (response, question), so the row count is the responder
        // count for every kind, and is not capped by the text display limit.
        const answered = question.answerCount;

        return { question, answered, choices, scale, texts };
      });

      return {
        survey: mapSummary(surveyRows[0]),
        responseCount: toInt(surveyRows[0].response_count),
        questions: results,
      };
    },
  };
}

export type SurveyStore = ReturnType<typeof createSurveyStore>;
