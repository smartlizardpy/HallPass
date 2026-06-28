/**
 * Auth.js v5 catch-all route — handles every provider endpoint under
 * `/api/auth/*` (sign-in, callback, sign-out, session, CSRF, providers).
 *
 * The handlers are defined once in `@/app/lib/auth` (the single `NextAuth(...)`
 * call) and merely re-exported here as the GET/POST route handlers this segment
 * requires; no logic lives in this file.
 */

import { handlers } from "@/app/lib/auth";

export const { GET, POST } = handlers;
