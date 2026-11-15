/**
 * A tiny DOM toolkit for the launcher: one element factory and the icon set.
 * No framework. The whole launcher has to fit comfortably in one file on a USB
 * stick, and a handful of screens does not need a virtual DOM.
 *
 * `h()` sets text through `textContent` and attributes through
 * `setAttribute`, never `innerHTML`. Package metadata (names, descriptions,
 * notes) is untrusted text and must never become markup.
 */

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: Record<string, string> };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = String(v);
      else if (k === "style") for (const [p, val] of Object.entries(v as Record<string, string>)) el.style.setProperty(p, val);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Stroke icons on a 24-unit grid (the same metrics as the site's nav icons). */
const ICONS: Record<string, string[]> = {
  play: ["M8 5.5v13l10.5-6.5z"],
  back: ["M15 18l-6-6 6-6"],
  restart: ["M3 12a9 9 0 1 0 3-6.7", "M3 4v5h5"],
  sound: ["M11 5L6 9H3v6h3l5 4z", "M15.5 8.5a5 5 0 0 1 0 7", "M18.5 5.5a9 9 0 0 1 0 13"],
  muted: ["M11 5L6 9H3v6h3l5 4z", "M22 9l-6 6", "M16 9l6 6"],
  expand: ["M8 3H3v5", "M16 3h5v5", "M21 16v5h-5", "M3 16v5h5"],
  shrink: ["M3 8h5V3", "M21 8h-5V3", "M16 21v-5h5", "M8 21v-5H3"],
  plus: ["M12 5v14", "M5 12h14"],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M21 21l-4.5-4.5"],
  upload: ["M12 16V4", "M7 9l5-5 5 5", "M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"],
  download: ["M12 4v12", "M7 11l5 5 5-5", "M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"],
  save: ["M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M7 3v6h8V3", "M7 21v-7h10v7"],
  check: ["M20 6L9 17l-5-5"],
  x: ["M18 6L6 18", "M6 6l12 12"],
  alert: ["M12 3l10 18H2z", "M12 10v4", "M12 17.5v.5"],
  minus: ["M5 12h14"],
  wifiOff: ["M2 2l20 20", "M8.5 16.5a5 5 0 0 1 7 0", "M5 12.5a10 10 0 0 1 4.2-2.4", "M12 20h.01", "M16.8 10.6A10 10 0 0 1 19 12.5", "M2 8.8a15 15 0 0 1 4.2-2.6", "M10.7 5a15 15 0 0 1 11.3 3.8"],
  info: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 16v-4", "M12 8h.01"],
  gamepad: ["M6 11h4", "M8 9v4", "M15 12h.01", "M18 10h.01", "M17.3 5H6.7a4 4 0 0 0-4 3.6L2 16a3 3 0 0 0 5.1 2.1L9 16h6l1.9 2.1A3 3 0 0 0 22 16l-.7-7.4A4 4 0 0 0 17.3 5z"],
};

export function icon(name: keyof typeof ICONS | string, cls = ""): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", name === "play" ? "currentColor" : "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  if (cls) svg.setAttribute("class", cls);
  for (const d of ICONS[name] ?? []) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  return svg;
}

export function wordmark(): HTMLElement {
  return h("span", { class: "wordmark", "aria-label": "HallPass" }, "hallpass", h("i"));
}
