// @vitest-environment jsdom
/**
 * Config resolution precedence: HALLPASS_CONFIG > data-* attributes > script
 * origin > page origin. A fabricated `<script>` element is injected per case
 * (the module-captured `document.currentScript` is null under jsdom).
 */
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "./config";

function makeScript(attrs: Record<string, string>): HTMLScriptElement {
  const script = document.createElement("script");
  for (const key of Object.keys(attrs)) {
    script.setAttribute(key, attrs[key]);
  }
  return script;
}

afterEach(() => {
  delete (window as unknown as { HALLPASS_CONFIG?: unknown }).HALLPASS_CONFIG;
});

describe("resolveConfig", () => {
  it("prefers window.HALLPASS_CONFIG over data-* and origin", () => {
    (window as unknown as { HALLPASS_CONFIG?: unknown }).HALLPASS_CONFIG = {
      game: "cfg-game",
      api: "https://cfg.example",
    };
    const script = makeScript({
      "data-game": "attr-game",
      "data-api": "https://attr.example",
      src: "https://cdn.example/sdk/v1/hallpass.js",
    });

    const result = resolveConfig(script);

    expect(result.game).toBe("cfg-game");
    expect(result.api).toBe("https://cfg.example");
  });

  it("falls back to data-* attributes and strips a trailing slash", () => {
    const script = makeScript({
      "data-game": "attr-game",
      "data-api": "https://attr.example/",
      src: "https://cdn.example/sdk/v1/hallpass.js",
    });

    const result = resolveConfig(script);

    expect(result.game).toBe("attr-game");
    expect(result.api).toBe("https://attr.example");
  });

  it("derives the api from the script origin when nothing overrides it", () => {
    const script = makeScript({
      "data-game": "snake",
      src: "https://hallpass.gg/sdk/v1/hallpass.js",
    });

    const result = resolveConfig(script);

    expect(result.game).toBe("snake");
    expect(result.api).toBe("https://hallpass.gg");
  });

  it("falls back to the page origin and a null game with no script", () => {
    const result = resolveConfig(null);

    expect(result.game).toBeNull();
    expect(typeof result.api).toBe("string");
  });
});
