// @vitest-environment jsdom
/**
 * The hook's lifecycle, with the watcher itself mocked (`stall-escape.test.ts`
 * covers the rule): the clock is cancelled when the router commits a navigation
 * (the pathname moves) and when the component goes away, and the function it
 * hands back arms the watcher for the tapped href.
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const watch = vi.fn();
const cancel = vi.fn();
let pathname = "/new";

vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("./stall-escape", () => ({ createStallEscape: () => ({ watch, cancel }) }));

import { useStallEscape } from "./use-stall-escape";

let armed: ((href: string) => void) | null = null;
function Probe() {
  armed = useStallEscape();
  return null;
}
const render = () => createElement(Probe);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useStallEscape", () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    watch.mockClear();
    cancel.mockClear();
    pathname = "/new";
    armed = null;
    host = document.createElement("div");
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
  });

  it("hands back a function that arms the watcher for the tapped href", () => {
    act(() => root.render(render()));
    armed?.("/play/you");
    expect(watch).toHaveBeenCalledExactlyOnceWith("/play/you");
  });

  it("cancels the clock when the router commits a navigation", () => {
    act(() => root.render(render()));
    cancel.mockClear();
    pathname = "/";
    act(() => root.render(render()));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("does not cancel on a re-render that did not move the pathname", () => {
    act(() => root.render(render()));
    cancel.mockClear();
    act(() => root.render(render()));
    expect(cancel).not.toHaveBeenCalled();
  });

  it("cancels the clock when the component unmounts", () => {
    act(() => root.render(render()));
    cancel.mockClear();
    act(() => root.unmount());
    expect(cancel).toHaveBeenCalledTimes(1);
    root = createRoot(host); // so afterEach's unmount has something to act on
  });
});
