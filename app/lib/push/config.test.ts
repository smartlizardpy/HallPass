/**
 * Tests for the push endpoint allowlist.
 *
 * The scheme check alone made this a server-side request forgery primitive: the
 * send path POSTs to whatever a subscriber stored, so any signed-in account
 * could have pointed it at an internal host.
 */

import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint } from "./config";

describe("isAllowedPushEndpoint", () => {
  it("accepts the real push services, including regional subdomains", () => {
    for (const url of [
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://android.googleapis.com/gcm/send/abc",
      "https://par02p.notify.windows.com/w/?token=abc",
      "https://web.push.apple.com/abc",
    ]) {
      expect(isAllowedPushEndpoint(url)).toBe(true);
    }
  });

  it("rejects an arbitrary host even over https", () => {
    expect(isAllowedPushEndpoint("https://internal.example/ingest")).toBe(false);
    expect(isAllowedPushEndpoint("https://127.0.0.1/")).toBe(false);
    expect(isAllowedPushEndpoint("https://localhost:8080/")).toBe(false);
  });

  it("is not fooled by a suffix that merely ends in the same letters", () => {
    // `endsWith` on the bare string would pass `evilpush.apple.com`; the check
    // requires a dot boundary.
    expect(isAllowedPushEndpoint("https://evilpush.apple.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.test/x")).toBe(false);
  });

  it("rejects a non-https scheme and unparsable input", () => {
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("not a url")).toBe(false);
    expect(isAllowedPushEndpoint("")).toBe(false);
  });
});
