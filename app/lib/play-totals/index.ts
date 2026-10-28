/**
 * HallPass — the permanent play totals: the live store bound to the shared Neon
 * client. Mirrors `app/lib/social/index.ts`; the factory stays testable, this is
 * the module that reaches for the real connection.
 */

import "server-only";
import { sql } from "@/app/lib/db";
import { createPlayTotalsStore } from "./store";

export const playTotals = createPlayTotalsStore(sql);
