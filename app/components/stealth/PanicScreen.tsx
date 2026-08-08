"use client";

/**
 * HallPass — the PANIC screen: a full-viewport disguise the boss key throws up
 * over the arcade in one keystroke, so a glance over the shoulder sees homework.
 *
 * This file is the REGISTRY and the OVERLAY SHELL. The disguises themselves live
 * one per file in {@link file://./screens/}, because each is a self-contained
 * recreation that gets worked on independently — keeping them apart means a
 * change to the Docs disguise can never disturb the Search one. Everything the
 * disguises share sits in `screens/chrome.tsx`.
 *
 * The shell owns two things the individual screens must not: the stacking
 * context that guarantees the disguise covers EVERYTHING (the arcade, the player
 * overlay, modals), and the dismiss affordance for touch devices with no
 * keyboard. When and how the overlay mounts is
 * {@link file://./StealthController.tsx}'s job, not this file's.
 */

import type { ReactElement } from "react";
import type { PanicScreenId } from "../../lib/stealth/config";
import { ClassroomScreen } from "./screens/ClassroomScreen";
import { DocsScreen } from "./screens/DocsScreen";
import { SearchScreen } from "./screens/SearchScreen";

/** A near-invisible 44px corner target so touch users can dismiss without a key. */
function DismissDot({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      aria-label="Return to HALLPASS"
      className="fixed bottom-0 right-0 z-10 h-11 w-11 cursor-default opacity-0"
    />
  );
}

/**
 * Every disguise the panic key can raise, keyed by the id persisted in prefs.
 * Must stay in step with `PANIC_SCREENS` in `lib/stealth/config.ts` — the type
 * annotation is what makes a missing entry a compile error rather than a blank
 * white screen at the exact moment the player needed a disguise.
 */
const SCREENS: Record<PanicScreenId, () => ReactElement> = {
  docs: DocsScreen,
  classroom: ClassroomScreen,
  search: SearchScreen,
};

/**
 * The panic overlay. `fixed inset-0` at the top of the stacking order so it
 * covers everything — the arcade, the player overlay, modals — completely.
 */
export function PanicScreen({
  screen,
  onDismiss,
}: {
  screen: PanicScreenId;
  onDismiss: () => void;
}) {
  const Screen = SCREENS[screen] ?? DocsScreen;
  return (
    <div className="fixed inset-0 z-[2147483647] overflow-auto bg-white" role="presentation">
      <Screen />
      <DismissDot onDismiss={onDismiss} />
    </div>
  );
}
