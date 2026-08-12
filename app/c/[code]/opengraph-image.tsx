import { ImageResponse } from "next/og";
import { getLink } from "@/app/lib/challenges";
import { normalizeLinkCode } from "@/app/lib/challenges/link";

/**
 * The preview card a challenge link shows in a chat.
 *
 * This is the first thing almost everybody sees of HallPass — before the
 * landing page, before the game. In a Snapchat or WhatsApp thread the card is
 * the entire pitch, and a link with no card is a grey rectangle nobody taps.
 *
 * ── IT CARRIES A HANDLE AND A NUMBER. NO AVATAR. ───────────────────────────
 * The store does not select one (see `LinkOwner`), and this is the surface that
 * decision was made for. A preview card is fetched by the CHAT PLATFORM and
 * cached on ITS servers and on the devices of everybody in the thread — so it
 * travels further than the page it advertises and is the hardest thing to
 * un-publish. Sign-in is Google-only, so an avatar here would frequently be a
 * real photograph of a child. A name and a score carry "beat me" fine.
 *
 * ── FAILURE IS A CARD, NOT A 500 ───────────────────────────────────────────
 * A crawler asking about a revoked or mistyped code still gets a valid image,
 * because a broken preview is worse than a plain one: some platforms cache the
 * failure and keep showing a grey box long after the link works again. The
 * generic card says nothing about anybody.
 *
 * No custom font is loaded. `ImageResponse`'s built-in face is enough for two
 * lines and a number, and a font file is a build asset that can go missing —
 * which would turn every preview on the site into a 500 at exactly the moment
 * nobody is looking at logs.
 */

export const alt = "A HallPass challenge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Brand values, inlined — this renders outside the app's CSS entirely, so it
 * cannot read the custom properties in `globals.css` and these must be kept in
 * step with them BY HAND. They are the literal values of `--brand`,
 * `--accent-yellow` and the zinc greys the rest of the site uses; a preview
 * card in the wrong colour is the first thing anybody sees of HallPass.
 */
const INK = "#18181b";
const BRAND = "#7c2eef"; // --brand
const DOT = "#ffc700"; // --accent-yellow, the wordmark's full stop
const PAPER = "#ffffff";
const MUTED = "#71717a";

export default async function Image({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const code = normalizeLinkCode((await params).code);
  const link = code ? await getLink(code) : null;
  const live = link && link.revokedAt === null ? link : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: PAPER,
          padding: 72,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 34,
            fontWeight: 800,
            color: INK,
            letterSpacing: -1,
          }}
        >
          HallPass
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 99,
              background: DOT,
              marginLeft: 8,
            }}
          />
        </div>

        {/*
          ONE WRAPPER DIV PER BRANCH, AND NEVER A FRAGMENT. Satori — which is
          what `ImageResponse` renders with — does not lay a React Fragment out
          as a flex child: the fragment's children get hoisted and inherit the
          ROOT's axis, so a column layout silently became a single row running
          off both edges of the card. It renders without error, which is the
          dangerous part; the only way to catch it is to look at the PNG.

          Every element also carries an explicit `display: flex`, which Satori
          requires on anything with more than one child.
        */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
          }}
        >
          {live ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                width: "100%",
              }}
            >
              <div
                style={{
                  display: "flex",
                  marginTop: 40,
                  fontSize: 48,
                  fontWeight: 700,
                  color: INK,
                  textAlign: "center",
                  // Wraps instead of overflowing when a handle is long.
                  maxWidth: 1000,
                  lineHeight: 1.2,
                }}
              >
                {/*
                  A TEMPLATE LITERAL, NOT JSX TEXT. `{name} says you can&apos;t…`
                  renders "Ozansays" — the text node's leading space is dropped
                  when it also carries an HTML entity. Building the whole
                  sentence in one expression has no JSX text to trim, and it
                  drops the entity (and the lint rule that forced it) with it.
                */}
                {`${live.owner.displayName} says you can't beat this`}
              </div>
              <div
                style={{
                  display: "flex",
                  marginTop: 20,
                  fontSize: 150,
                  fontWeight: 900,
                  color: BRAND,
                  lineHeight: 1,
                }}
              >
                {live.targetScore.toLocaleString("en-US")}
              </div>
              <div
                style={{
                  display: "flex",
                  marginTop: 18,
                  fontSize: 32,
                  fontWeight: 600,
                  color: MUTED,
                }}
              >
                {live.boardTitle} · no account needed
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                marginTop: 40,
                fontSize: 56,
                fontWeight: 700,
                color: INK,
              }}
            >
              Beat somebody&apos;s high score
            </div>
          )}
        </div>
      </div>
    ),
    size,
  );
}
