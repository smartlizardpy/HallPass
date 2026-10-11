import { describe, expect, it } from "vitest";
import {
  isGateExempt,
  landingTarget,
  nextOnboardingStep,
  shouldRedirectToWelcome,
  type OnboardingState,
} from "./onboarding";

const full: OnboardingState = {
  handle: "Ada",
  username: "ada",
  avatarMeme: "doge",
  avatarSkipped: false,
};

describe("nextOnboardingStep", () => {
  it("asks for the handle first, whatever else is missing", () => {
    expect(
      nextOnboardingStep({ ...full, handle: null, username: null, avatarMeme: null }),
    ).toBe("handle");
    expect(nextOnboardingStep({ ...full, handle: undefined })).toBe("handle");
  });
  it("then the username, then the avatar", () => {
    expect(nextOnboardingStep({ ...full, username: null, avatarMeme: null })).toBe("username");
    expect(nextOnboardingStep({ ...full, avatarMeme: null })).toBe("avatar");
  });
  it("does not ask for an avatar after a skip or once chosen", () => {
    expect(nextOnboardingStep({ ...full, avatarMeme: null, avatarSkipped: true })).toBe("done");
    expect(nextOnboardingStep({ ...full, avatarSkipped: true })).toBe("done");
    expect(nextOnboardingStep(full)).toBe("done");
  });
});

describe("landingTarget", () => {
  it("goes to the destination when nothing is missing", () => {
    expect(landingTarget(full, "/game/x")).toBe("/game/x");
  });
  it("routes a player with no handle through welcome, carrying next", () => {
    expect(landingTarget({ ...full, handle: null, username: null }, "/game/x?a=1")).toBe(
      "/play/welcome?next=%2Fgame%2Fx%3Fa%3D1",
    );
  });
});

describe("shouldRedirectToWelcome", () => {
  it("always redirects a missing handle on a normal page, even if prompted before", () => {
    expect(shouldRedirectToWelcome({ pathname: "/", step: "handle", alreadyPrompted: true })).toBe(true);
    expect(shouldRedirectToWelcome({ pathname: "/game/x", step: "handle", alreadyPrompted: false })).toBe(true);
  });
  it("prompts for the optional steps once only", () => {
    expect(shouldRedirectToWelcome({ pathname: "/", step: "username", alreadyPrompted: false })).toBe(true);
    expect(shouldRedirectToWelcome({ pathname: "/", step: "avatar", alreadyPrompted: true })).toBe(false);
  });
  it("never fires on the flow itself, the popup, or admin surfaces", () => {
    for (const p of [
      "/play/welcome",
      "/play/auth/complete",
      "/play/signin",
      "/dashboard/x",
      "/oauth/authorize",
    ]) {
      expect(isGateExempt(p)).toBe(true);
      expect(shouldRedirectToWelcome({ pathname: p, step: "handle", alreadyPrompted: false })).toBe(false);
    }
    expect(isGateExempt("/play/you")).toBe(false);
    expect(isGateExempt("/play/authentic")).toBe(false);
  });
  it("does nothing when onboarding is done", () => {
    expect(shouldRedirectToWelcome({ pathname: "/", step: "done", alreadyPrompted: false })).toBe(false);
  });
});
