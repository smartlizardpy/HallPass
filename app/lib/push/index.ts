/**
 * HallPass — the push barrel: the live store bound to the shared Neon client.
 *
 * Mirrors `challenges/index.ts`, `tracker/index.ts` and `social/index.ts`. The
 * factory in `store.ts` stays free of `server-only` so it can be unit-tested
 * against a fake tagged template; THIS module reaches for the real connection,
 * so it is the one that must never reach a client bundle.
 *
 * It exists because two callers — the send path and the subscribe route — were
 * each doing `createPushStore(sql)`, which is two live instances of something
 * the rest of the codebase deliberately has exactly one of per module. Nothing
 * broke, but the next caller would have made it three.
 *
 * NO FAIL-SOFT READ WRAPPERS HERE, unlike the challenges barrel. There is no
 * read a page renders: `devicesFor` is only ever called from the send path,
 * which already swallows everything (see `send.ts`), and the routes need to tell
 * "refused" from "the database is down" to choose a status code. Adding wrappers
 * nothing calls would be cargo-culting the shape of a neighbouring module.
 */

import "server-only";
import { sql } from "@/app/lib/db";
import { createPushStore } from "./store";

/** The live store. */
export const push = createPushStore(sql);

export type { PushDevice } from "./store";
