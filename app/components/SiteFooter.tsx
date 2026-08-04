import { DeviceSwitch } from "./DeviceSwitch";
import { Wordmark } from "./Wordmark";

/**
 * The public site footer.
 *
 * Lifted verbatim out of `Arcade` so the store page and any future public route
 * gets the same footer instead of a second copy. Server component — it holds no
 * state and no handlers.
 *
 * The `paddingBottom: calc(2.5rem + env(safe-area-inset-bottom))` is
 * load-bearing on installed iOS PWAs, where the home indicator otherwise overlaps
 * the last line of credits. It cannot move to a Tailwind class because
 * `env()` inside `calc()` is not expressible in the utility set here.
 *
 * Uses `Wordmark`, which documents itself as the single source of truth for the
 * brand mark; the footer previously hand-inlined its own copy (one of four such
 * copies across the arcade).
 */
export function SiteFooter() {
  return (
    <footer
      className="mt-16 px-3 py-10 sm:px-8"
      style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}
    >
      <div className="flex flex-col items-start justify-between gap-4 rounded-3xl bg-white p-6 sm:flex-row sm:items-center sm:p-8">
        <Wordmark />
        <div className="text-[13px] font-bold text-muted sm:text-right">
          <p>
            Games by <span className="text-zinc-900">Ateş Demir</span> · Site by{" "}
            <span className="text-zinc-900">Ozan Kaygusuz</span>
          </p>
          <p className="mt-1 text-muted/80">
            © {new Date().getFullYear()} · all games unblocked, forever.
          </p>
        </div>
      </div>

      {/* Phone-only escape hatch to the full desktop site (renders nothing on
          desktop). Client island inside this server component. */}
      <DeviceSwitch />
    </footer>
  );
}
