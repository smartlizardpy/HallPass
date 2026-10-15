/**
 * The homepage/category sidebar runs in callback mode (`onSelect`), where it used
 * to emit `<button>`s — so the server-delivered HTML carried no `/category/...`
 * links and crawlers had no path to a genre from the homepage. Pin that every
 * genre is a real anchor in the SERVER render.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, prefetch: () => {} }),
}));

import { Sidebar } from "./Sidebar";

describe("Sidebar category navigation", () => {
  it("renders a crawlable anchor per category in callback mode", () => {
    const html = renderToStaticMarkup(
      createElement(Sidebar, {
        categories: ["Horror", "Puzzle"],
        active: "All",
        onSelect: () => {},
      }),
    );
    for (const href of ["/", "/category/new", "/category/trending", "/category/horror", "/category/puzzle"]) {
      expect(html).toContain(`href="${href}"`);
    }
  });
});
