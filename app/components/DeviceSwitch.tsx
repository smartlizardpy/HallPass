"use client";

/**
 * The "View desktop version" / "Switch to mobile version" link.
 *
 * Only a real phone is offered the choice — it reads {@link useRawDevice} (the
 * hardware detection, NOT the effective device), so it stays visible even while a
 * phone is being shown the desktop site, which is the only way back. On an actual
 * desktop there is nothing to switch, so it renders nothing.
 *
 * Flipping the preference re-renders every consumer of `useDevicePlatform` at
 * once (see the store note there), so this one link turns the whole shell over.
 */

import {
  setForceDesktop,
  useForceDesktop,
  useRawDevice,
} from "../lib/use-device-platform";

export function DeviceSwitch() {
  const raw = useRawDevice();
  const forceDesktop = useForceDesktop();

  if (raw !== "mobile") return null;

  return (
    <div className="mt-4 text-center">
      <button
        type="button"
        onClick={() => setForceDesktop(!forceDesktop)}
        style={{ touchAction: "manipulation" }}
        className="text-[13px] font-bold text-brand underline underline-offset-4 transition hover:text-brand-600"
      >
        {forceDesktop ? "Switch to mobile version" : "View desktop version"}
      </button>
    </div>
  );
}
