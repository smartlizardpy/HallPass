/**
 * The HallPass Offline Arcade launcher: the whole app in the single
 * `index.html` a player double-clicks.
 *
 * Screens: WELCOME (empty library: how to import), LIBRARY (cards, search,
 * category filter), PLAYER (one game in its sandboxed frame, with Back /
 * Restart / Sound / Fullscreen), plus dialogs for import results, game
 * details and saves. Everything runs offline. The only inputs are the files the
 * player picks or drops, and they are verified before anything runs
 * (archive/*).
 *
 * Two values are baked in at build time (build/launcher.ts):
 *   __HPG_RUNTIME__ — the guest bootstrap injected into every game frame
 *   __HPG_TRUST__   — the manifest digests of the packages built alongside this
 *                     launcher; nothing else imports (docs/hpg-format.md §5)
 */

import { importSources, type ImportItem, type ImportSource } from "../archive/collection";
import { COLLECTION_LIMITS, LAUNCHER_VERSION } from "../format/constants";
import { mimeTypeOf } from "../format/paths";
import { openKv, type KvStore } from "../host/kv";
import { PackageLibrary, type AddOutcome, type InstalledGame } from "../host/library";
import { SaveStore } from "../host/saves";
import { GameSession } from "../host/session";
import { ObjectUrlPool } from "../host/urls";
import { append, h, icon, wordmark } from "./dom";
import { friendlyError } from "./messages";

declare const __HPG_RUNTIME__: string;
declare const __HPG_TRUST__: { packages: { id: string; version: string; manifestDigest: string }[] };

const trusted = new Set(__HPG_TRUST__.packages.map((p) => p.manifestDigest));
const readOptions = { trustedManifestDigests: trusted };

type Player = {
  game: InstalledGame;
  root: HTMLElement;
  stage: HTMLElement;
  session: GameSession | null;
  soundBtn: HTMLButtonElement;
  fsBtn: HTMLButtonElement;
  message: HTMLElement | null;
  reportedError: boolean;
  starting: boolean;
};

const state = {
  kv: null as KvStore | null,
  storageReason: undefined as string | undefined,
  saves: null as unknown as SaveStore,
  library: null as unknown as PackageLibrary,
  muted: false,
  handle: "Player",
  query: "",
  category: "All",
  player: null as Player | null,
};

const covers = new ObjectUrlPool();
const app = document.getElementById("app")!;
const plainVersion = (v: string) => v.split("+")[0];

// ------------------------------------------------------------------ boot

async function boot(): Promise<void> {
  app.append(h("main", { class: "main" }, h("p", { class: "muted" }, "Opening your arcade…")));
  const { kv, reason } = await openKv();
  state.kv = kv;
  state.storageReason = reason;
  state.saves = new SaveStore(kv);
  const { library, dropped } = await PackageLibrary.open(kv, readOptions);
  state.library = library;
  state.muted = (await kv.get<boolean>("settings", "muted")) ?? false;
  state.handle = (await kv.get<string>("settings", "handle")) ?? "Player";
  render();
  if (dropped.length) {
    toast(`${dropped.length === 1 ? "A stored game" : `${dropped.length} stored games`} failed an integrity check and ${dropped.length === 1 ? "was" : "were"} removed. Import games.zip again to restore.`);
  }
  setupDragAndDrop();
  setupKeyboard();
  document.addEventListener("visibilitychange", () => {
    const s = state.player?.session;
    if (!s) return;
    if (document.visibilityState === "hidden") s.pause();
    else s.resume();
  });
}

// ------------------------------------------------------------------ rendering

function render(): void {
  covers.releaseAll();
  app.replaceChildren(state.library.size === 0 ? welcomeScreen() : libraryScreen());
}

function topbar(): HTMLElement {
  return h(
    "header",
    { class: "topbar" },
    wordmark(),
    h("span", { class: "tag" }, "Offline Arcade"),
    h("span", { class: "spacer" }),
    state.library.size > 0 ? h("button", { class: "btn", type: "button", onClick: () => pickFiles() }, icon("plus"), h("span", null, "Add games")) : null,
    h("button", { class: "btn ghost", type: "button", onClick: openSavesDialog }, icon("save"), h("span", null, "Saves")),
    soundToggle("btn ghost icon"),
  );
}

function paintSound(btn: HTMLElement): void {
  btn.replaceChildren(icon(state.muted ? "muted" : "sound"));
  btn.setAttribute("aria-label", state.muted ? "Turn sound on" : "Turn sound off");
  btn.setAttribute("aria-pressed", String(state.muted));
  btn.title = state.muted ? "Sound off" : "Sound on";
}

/** A sound button. Every one on the page (top bar, player bar) repaints together. */
function soundToggle(cls: string): HTMLButtonElement {
  const btn = h("button", { class: cls, type: "button", "data-sound-toggle": "" });
  paintSound(btn);
  btn.addEventListener("click", async () => {
    state.muted = !state.muted;
    for (const b of document.querySelectorAll<HTMLElement>("[data-sound-toggle]")) paintSound(b);
    state.player?.session?.setMuted(state.muted);
    await state.kv?.put("settings", "muted", state.muted).catch(() => {});
  });
  return btn;
}

function storageNotice(): HTMLElement | null {
  if (state.kv?.persistent) return null;
  return h(
    "div",
    { class: "notice", role: "status" },
    icon("info"),
    h(
      "div",
      null,
      "This browser won't keep your games or progress after you close this page. Next time, import games.zip again, and use ",
      h("strong", null, "Saves → Export"),
      " to keep your progress.",
      state.storageReason ? h("details", null, h("summary", null, "Why?"), h("pre", null, state.storageReason)) : null,
    ),
  );
}

function welcomeScreen(): HTMLElement {
  const drop = h(
    "div",
    { class: "drop" },
    icon("gamepad", "big"),
    h("strong", null, "Drop games.zip here"),
    h("span", null, "or"),
    h("button", { class: "btn primary", type: "button", onClick: () => pickFiles() }, icon("upload"), "Browse files"),
    h("span", null, "You can also add single .hpg game files."),
  );
  return h(
    "div",
    { class: "shell" },
    topbar(),
    h(
      "main",
      { class: "main" },
      storageNotice(),
      h(
        "section",
        { class: "welcome" },
        h("h1", null, "Your arcade, ", h("em", null, "anywhere"), "."),
        h("p", { class: "lede" }, "Every game here runs on this computer. No internet, no installing, no account."),
        h(
          "ol",
          { class: "steps" },
          h("li", null, "Find ", h("code", null, "games.zip"), " in the same folder as this page."),
          h("li", null, "Drop it on the box below, or choose Browse files."),
          h("li", null, "Pick a game and play, even with the internet off."),
        ),
        drop,
      ),
    ),
  );
}

function categoriesOf(games: InstalledGame[]): string[] {
  return ["All", ...Array.from(new Set(games.map((g) => g.pkg.manifest.category ?? "Other"))).sort()];
}

function libraryScreen(): HTMLElement {
  const games = state.library.list();
  const cats = categoriesOf(games);
  if (!cats.includes(state.category)) state.category = "All";
  const grid = h("div", { class: "grid", role: "list", "aria-label": "Games" });
  const empty = h("p", { class: "empty-search", hidden: true }, "No games match your search.");

  const paint = () => {
    const q = state.query.trim().toLowerCase();
    const shown = games.filter((g) => {
      const m = g.pkg.manifest;
      const inCat = state.category === "All" || (m.category ?? "Other") === state.category;
      const hay = `${m.name} ${m.description} ${m.category ?? ""} ${(m.tags ?? []).join(" ")}`.toLowerCase();
      return inCat && (!q || hay.includes(q));
    });
    grid.replaceChildren(...shown.map(gameCard));
    empty.hidden = shown.length > 0;
  };

  const search = h("input", {
    type: "search",
    placeholder: "Search your games",
    "aria-label": "Search your games",
    value: state.query,
    onInput: (e: Event) => {
      state.query = (e.target as HTMLInputElement).value;
      paint();
    },
  });
  const chips = cats.length > 2
    ? cats.map((c) =>
        h("button", {
          class: "chip",
          type: "button",
          "aria-pressed": String(state.category === c),
          onClick: (e: Event) => {
            state.category = c;
            for (const el of (e.currentTarget as HTMLElement).parentElement!.querySelectorAll(".chip")) {
              el.setAttribute("aria-pressed", String(el.textContent === c));
            }
            paint();
          },
        }, c),
      )
    : [];
  paint();
  return h(
    "div",
    { class: "shell" },
    topbar(),
    h(
      "main",
      { class: "main" },
      storageNotice(),
      h("div", { class: "lib-head" }, h("div", null, h("h1", null, "Your arcade"), h("p", null, `${games.length} ${games.length === 1 ? "game" : "games"} ready to play offline`))),
      h("div", { class: "filters" }, h("label", { class: "search" }, icon("search"), search), ...chips),
      grid,
      empty,
    ),
  );
}

function coverElement(game: InstalledGame, cls: string): HTMLElement {
  const m = game.pkg.manifest;
  const [g1, g2] = m.gradient ?? [m.accent ?? "#7c2eef", "#111118"];
  const box = h("div", { class: cls, style: { "--g1": g1, "--g2": g2 } });
  if (m.thumbnail && game.pkg.files.has(m.thumbnail)) {
    const thumb = m.thumbnail;
    const url = covers.get(`${m.id}:${game.pkg.manifestDigest}`, () => new Blob([game.pkg.files.get(thumb)! as BlobPart], { type: mimeTypeOf(thumb) }));
    box.append(h("img", { src: url, alt: "", loading: "lazy", decoding: "async" }));
  } else {
    box.append(h("span", { class: "initial", "aria-hidden": "true" }, m.name.slice(0, 1)));
  }
  return box;
}

function gameCard(game: InstalledGame): HTMLElement {
  const m = game.pkg.manifest;
  const cover = coverElement(game, "cover");
  cover.append(h("span", { class: "play-badge", "aria-hidden": "true" }, icon("play")));
  const card = h(
    "button",
    {
      class: "card",
      type: "button",
      "aria-label": `Play ${m.name}`,
      onClick: () => void play(game),
      onContextmenu: (e: Event) => {
        e.preventDefault();
        void openDetails(game);
      },
    },
    cover,
    h(
      "div",
      { class: "card-body" },
      h("h2", { class: "card-title" }, m.name),
      h("p", { class: "card-desc" }, m.description),
      h(
        "div",
        { class: "meta" },
        h("span", { class: "pill" }, m.category ?? "Game"),
        h("span", { class: "pill offline" }, icon("check"), "Offline"),
      ),
    ),
  );
  const info = h("button", { class: "btn ghost icon card-info", type: "button", "aria-label": `About ${m.name}`, title: "About this game", onClick: () => void openDetails(game) }, icon("info"));
  return h("div", { class: "card-wrap", role: "listitem", "data-game": m.id }, card, info);
}

// ------------------------------------------------------------------ import

let fileInput: HTMLInputElement | null = null;
function pickFiles(): void {
  if (!fileInput) {
    fileInput = h("input", { type: "file", accept: ".zip,.hpg", multiple: true, class: "sr-only", tabindex: "-1", "aria-hidden": "true" });
    fileInput.addEventListener("change", () => {
      const files = [...(fileInput!.files ?? [])];
      fileInput!.value = "";
      if (files.length) void importFiles(files);
    });
    document.body.append(fileInput);
  }
  fileInput.click();
}

type ResultLine = { kind: "ok" | "bad" | "skip"; title: string; detail?: string; tech?: string[] };

function describeItem(item: ImportItem, outcomes: Map<string, AddOutcome>): ResultLine {
  switch (item.status) {
    case "ok": {
      const m = item.pkg.manifest;
      const o = outcomes.get(m.id);
      if (!o) return { kind: "bad", title: m.name, detail: "Could not be saved to the arcade." };
      if (o.kind === "added") return { kind: "ok", title: `${m.name} added` };
      if (o.kind === "updated") return { kind: "ok", title: `${m.name} updated`, detail: `Version ${plainVersion(o.from)} → ${plainVersion(o.to)}` };
      if (o.kind === "replaced") return { kind: "ok", title: `${m.name} replaced`, detail: `Now version ${plainVersion(o.to)}` };
      return { kind: "skip", title: `${m.name} is already in your arcade` };
    }
    case "duplicate":
      return { kind: "skip", title: item.source, detail: `This game was included twice; kept version ${plainVersion(item.keptVersion)}.` };
    case "skipped":
      return { kind: "skip", title: item.source, detail: `Skipped: ${item.reason}.` };
    case "error":
      return { kind: "bad", title: item.source, detail: friendlyError(item.code, item.message), tech: [item.code, ...item.details] };
  }
}

async function importFiles(files: File[]): Promise<void> {
  const bar = h("div");
  const label = h("p", { class: "muted" }, "Reading files…");
  const list = h("ul", { class: "results" });
  const done = h("button", { class: "btn primary", type: "button", disabled: true }, "Done");
  const dlg = dialog(h("h2", null, "Adding games"), h("div", { class: "progress", role: "progressbar", "aria-label": "Import progress" }, bar), label, list, h("div", { class: "dlg-actions" }, done));
  done.addEventListener("click", () => dlg.close());

  const lines: ResultLine[] = [];
  const sources: ImportSource[] = [];
  for (const f of files) {
    if (f.size > COLLECTION_LIMITS.maxTotalBytes) {
      lines.push({ kind: "bad", title: f.name, detail: friendlyError("too-large") });
      continue;
    }
    try {
      sources.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    } catch {
      lines.push({ kind: "bad", title: f.name, detail: "The browser could not read this file." });
    }
  }
  const report = await importSources(sources, readOptions, (n, total, what) => {
    bar.style.width = `${total ? Math.round((n / total) * 100) : 100}%`;
    label.textContent = total ? `Checking game ${Math.min(n + 1, total)} of ${total}…` : "Checking…";
    if (what) label.title = what;
  });
  const outcomes = new Map<string, AddOutcome>();
  for (const pkg of report.packages) {
    try {
      const o = await state.library.add(pkg);
      outcomes.set(pkg.manifest.id, o);
      if (o.kind === "updated" || o.kind === "replaced") covers.release(`${pkg.manifest.id}:`);
    } catch {
      /* reported below as "could not be saved" */
    }
  }
  lines.push(...report.items.map((i) => describeItem(i, outcomes)));
  bar.style.width = "100%";
  const added = [...outcomes.values()].filter((o) => o.kind !== "unchanged").length;
  const failed = lines.filter((l) => l.kind === "bad").length;
  label.textContent =
    added > 0
      ? `${added} ${added === 1 ? "game" : "games"} ready to play.${failed ? ` ${failed} could not be added.` : ""}`
      : failed
        ? "No games could be added."
        : "Nothing new to add.";
  list.replaceChildren(
    ...lines.map((l) =>
      h(
        "li",
        { class: l.kind },
        icon(l.kind === "ok" ? "check" : l.kind === "bad" ? "x" : "minus"),
        h(
          "div",
          null,
          l.title,
          l.detail ? h("small", null, l.detail) : null,
          l.tech?.length ? h("details", null, h("summary", null, "Details"), h("pre", null, l.tech.join("\n"))) : null,
        ),
      ),
    ),
  );
  done.disabled = false;
  done.focus();
  if (added > 0) {
    void navigator.storage?.persist?.().catch(() => false);
    render();
  }
}

// ------------------------------------------------------------------ dialogs

function dialog(...children: (Node | null)[]): HTMLDialogElement {
  const dlg = h("dialog", null, h("div", { class: "dlg" }));
  append(dlg.firstChild!, children);
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

async function openDetails(game: InstalledGame): Promise<void> {
  const m = game.pkg.manifest;
  const order = m.features?.scoreOrder ?? "desc";
  const scores = (await state.saves.scores(m.id, order)).slice(0, 5);
  const save = await state.saves.load(m.id);
  const notes = m.compatibility?.notes ?? [];
  const pills = [m.category, ...(m.inputs ?? []).map((i) => i[0].toUpperCase() + i.slice(1)), `v${plainVersion(m.version)}`].filter(Boolean) as string[];
  const close = h("button", { class: "btn ghost", type: "button" }, "Close");
  const playBtn = h("button", { class: "btn primary", type: "button" }, icon("play"), "Play");
  const reset = h("button", { class: "btn danger", type: "button", disabled: !save }, "Reset progress");
  const remove = h("button", { class: "btn danger", type: "button" }, "Remove");
  const dlg = dialog(
    coverElement(game, "dlg-cover"),
    h("h2", null, m.name),
    m.author ? h("p", { class: "muted" }, `By ${m.author}`) : null,
    h("div", { class: "meta" }, ...pills.map((p) => h("span", { class: "pill" }, p)), h("span", { class: "pill offline" }, icon("check"), "Offline")),
    h("p", null, m.description),
    notes.length ? h("ul", { class: "muted" }, ...notes.map((n) => h("li", null, n))) : null,
    m.features?.scores
      ? h("div", null, h("p", { class: "muted" }, "Top scores on this computer"), scores.length ? h("ol", { class: "scores" }, ...scores.map((s) => h("li", null, h("span", null, `${s.rank}. ${s.handle}`), h("span", null, s.score.toLocaleString())))) : h("p", { class: "muted" }, "No scores yet."))
      : null,
    h("div", { class: "dlg-actions" }, remove, reset, close, playBtn),
  );
  close.addEventListener("click", () => dlg.close());
  playBtn.addEventListener("click", () => {
    dlg.close();
    void play(game);
  });
  reset.addEventListener("click", async () => {
    if (reset.dataset.confirm !== "1") {
      reset.dataset.confirm = "1";
      reset.textContent = "Tap again to reset";
      return;
    }
    await state.saves.remove(m.id);
    dlg.close();
    toast(`${m.name}'s progress and scores were reset.`);
  });
  remove.addEventListener("click", async () => {
    if (remove.dataset.confirm !== "1") {
      remove.dataset.confirm = "1";
      remove.textContent = "Tap again to remove";
      return;
    }
    await state.library.remove(m.id);
    covers.release(`${m.id}:`);
    dlg.close();
    render();
    toast(`${m.name} was removed. Its saves are kept, so you can add it back.`);
  });
  playBtn.focus();
}

async function openSavesDialog(): Promise<void> {
  const exported = await state.saves.exportAll();
  const names = new Map(state.library.list().map((g) => [g.pkg.manifest.id, g.pkg.manifest.name]));
  const status = state.kv?.persistent
    ? "Progress is saved in this browser automatically. Export a copy to move it to another computer or keep it safe."
    : "This browser can't keep progress after you close the page. Export your saves before you leave.";
  const name = h("input", { value: state.handle, maxlength: "32", autocomplete: "off" });
  name.addEventListener("change", async () => {
    state.handle = name.value.trim().slice(0, 32) || "Player";
    name.value = state.handle;
    await state.kv?.put("settings", "handle", state.handle).catch(() => {});
  });
  const exportBtn = h("button", { class: "btn primary", type: "button", disabled: exported.saves.length === 0 && Object.keys(exported.scores).length === 0 }, icon("download"), "Export saves");
  const importBtn = h("button", { class: "btn", type: "button" }, icon("upload"), "Import saves");
  const result = h("p", { class: "muted", role: "status" });
  const close = h("button", { class: "btn ghost", type: "button" }, "Close");
  const dlg = dialog(
    h("h2", null, "Saves"),
    h("p", { class: "muted" }, status),
    h("label", { class: "field" }, "Your name on local leaderboards", name),
    exported.saves.length
      ? h("ul", { class: "saves-list" }, ...exported.saves.map((s) => h("li", null, h("span", null, names.get(s.gameId) ?? s.gameId), h("small", { class: "muted" }, new Date(s.updatedAt).toLocaleString()))))
      : h("p", { class: "muted" }, "No saved progress yet."),
    h("div", { class: "row" }, exportBtn, importBtn),
    result,
    h("div", { class: "dlg-actions" }, close),
  );
  close.addEventListener("click", () => dlg.close());
  exportBtn.addEventListener("click", async () => {
    const data = JSON.stringify(await state.saves.exportAll(), null, 2);
    download(new Blob([data], { type: "application/json" }), `hallpass-arcade-saves-${new Date().toISOString().slice(0, 10)}.json`);
    result.textContent = "Saves exported. Keep the file somewhere safe.";
  });
  importBtn.addEventListener("click", () => {
    const input = h("input", { type: "file", accept: ".json,application/json", class: "sr-only" });
    input.addEventListener("change", async () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) return;
      try {
        if (f.size > 16 * 1024 * 1024) throw new Error("This file is too large to be a saves file.");
        const r = await state.saves.importAll(JSON.parse(await f.text()));
        result.textContent = `Imported ${r.imported} ${r.imported === 1 ? "save" : "saves"} and ${r.scores} ${r.scores === 1 ? "score" : "scores"}.${r.rejected.length ? ` ${r.rejected.length} could not be imported.` : ""}`;
      } catch (e) {
        result.textContent = e instanceof SyntaxError ? "That file isn't a saves file." : e instanceof Error ? e.message : "That file couldn't be imported.";
      }
    });
    document.body.append(input);
    input.click();
  });
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename, class: "sr-only" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ------------------------------------------------------------------ toasts

function toast(message: string, details?: string): void {
  let box = document.querySelector<HTMLElement>(".toasts");
  if (!box) {
    box = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
    document.body.append(box);
  }
  const close = h("button", { type: "button", "aria-label": "Dismiss" }, "✕");
  const el = h(
    "div",
    { class: "toast" },
    h("div", { class: "grow" }, message, details ? h("details", null, h("summary", null, "Details"), h("pre", null, details)) : null),
    close,
  );
  const timer = setTimeout(() => el.remove(), details ? 12_000 : 6_000);
  close.addEventListener("click", () => {
    clearTimeout(timer);
    el.remove();
  });
  box.append(el);
}

// ------------------------------------------------------------------ player

async function play(game: InstalledGame): Promise<void> {
  if (state.player) await closePlayer(false);
  const m = game.pkg.manifest;
  const stage = h("div", { class: "player-stage" });
  const back = h("button", { class: "btn", type: "button", "aria-label": "Back to arcade" }, icon("back"), h("span", null, "Arcade"));
  const restart = h("button", { class: "btn icon", type: "button", "aria-label": "Restart game", title: "Restart" }, icon("restart"));
  const fsBtn = h("button", { class: "btn icon", type: "button", "aria-label": "Fullscreen", title: "Fullscreen" }, icon("expand"));
  const soundBtn = soundToggle("btn icon");
  const root = h(
    "section",
    { class: "player", "aria-label": m.name },
    h("div", { class: "player-bar" }, back, h("h1", { class: "title" }, m.name), h("span", { class: "spacer" }), restart, soundBtn, fsBtn),
    stage,
  );
  const player: Player = { game, root, stage, session: null, soundBtn, fsBtn, message: null, reportedError: false, starting: false };
  state.player = player;
  app.inert = true;
  document.body.append(root);
  back.addEventListener("click", () => void closePlayer(true));
  restart.addEventListener("click", () => void restartGame());
  fsBtn.addEventListener("click", () => toggleFullscreen());
  root.addEventListener("pointermove", (e: PointerEvent) => {
    if (!document.fullscreenElement) return;
    if (e.clientY < 64) {
      root.classList.add("show-bar");
      clearTimeout(barTimer);
      barTimer = setTimeout(() => root.classList.remove("show-bar"), 2500);
    }
  });
  await startSession(player);
}

let barTimer: ReturnType<typeof setTimeout> | undefined;

function stageMessage(player: Player, ...children: (Node | string)[]): void {
  player.message?.remove();
  const msg = h("div", { class: "stage-msg" }, h("div", null, ...children));
  player.message = msg;
  player.stage.append(msg);
}

async function startSession(player: Player): Promise<void> {
  if (player.starting) return;
  player.starting = true;
  const m = player.game.pkg.manifest;
  const order = m.features?.scoreOrder ?? "desc";
  const save = await state.saves.load(m.id);
  stageMessage(player, h("span", { class: "loading-dot", "aria-hidden": "true" }), `Starting ${m.name}…`);
  const session = new GameSession({
    container: player.stage,
    pkg: player.game.pkg,
    save: save?.data ?? null,
    muted: state.muted,
    handle: state.handle,
    runtimeJs: __HPG_RUNTIME__,
    callbacks: {
      onReady: () => {
        player.message?.remove();
        player.message = null;
        session.focus();
      },
      onExit: () => void closePlayer(true),
      onError: (message) => {
        if (player.reportedError) return;
        player.reportedError = true;
        toast(`${m.name} reported a problem. If it stops working, press Restart.`, message);
      },
      onSave: async (data) => {
        try {
          await state.saves.save(m.id, m.version, data);
        } catch (e) {
          toast("Your progress couldn't be saved in this browser. Use Saves → Export to keep it.", e instanceof Error ? e.message : String(e));
        }
      },
      onScore: (score, handle) => state.saves.addScore(m.id, score, handle ?? state.handle, order),
      onScoresRequest: async (limit) => (await state.saves.scores(m.id, order)).slice(0, limit),
      onLoadRequest: async () => (await state.saves.load(m.id))?.data ?? null,
      onSlowStart: () => {
        const r = h("button", { class: "btn primary", type: "button", onClick: () => void restartGame() }, "Restart");
        const b = h("button", { class: "btn", type: "button", onClick: () => void closePlayer(true) }, "Back to arcade");
        stageMessage(player, `${m.name} is taking a long time to start.`, h("div", { class: "row" }, r, b));
      },
      onFullscreenRequest: () => toggleFullscreen(),
      onReload: () => void restartGame(),
    },
  });
  player.session = session;
  try {
    session.start();
  } catch (e) {
    stageMessage(player, `${m.name} couldn't start.`, h("button", { class: "btn", type: "button", onClick: () => void closePlayer(true) }, "Back to arcade"));
    toast(`${m.name} couldn't start.`, e instanceof Error ? e.message : String(e));
  } finally {
    player.starting = false;
  }
}

async function restartGame(): Promise<void> {
  const player = state.player;
  if (!player || player.starting) return;
  const s = player.session;
  player.session = null;
  await s?.close();
  if (state.player === player) await startSession(player);
}

function toggleFullscreen(): void {
  const player = state.player;
  if (!player) return;
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void player.root.requestFullscreen?.().catch(() => toast("This browser didn't allow fullscreen here."));
}

document.addEventListener("fullscreenchange", () => {
  const player = state.player;
  if (!player) return;
  const on = !!document.fullscreenElement;
  player.fsBtn.replaceChildren(icon(on ? "shrink" : "expand"));
  player.fsBtn.setAttribute("aria-label", on ? "Exit fullscreen" : "Fullscreen");
  player.session?.focus();
});

async function closePlayer(restoreFocus: boolean): Promise<void> {
  const player = state.player;
  if (!player) return;
  state.player = null;
  await player.session?.close();
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  player.root.remove();
  clearTimeout(barTimer);
  app.inert = false;
  if (restoreFocus) app.querySelector<HTMLElement>(`.card-wrap[data-game="${CSS.escape(player.game.pkg.manifest.id)}"] .card`)?.focus();
}

// ------------------------------------------------------------------ input

function setupDragAndDrop(): void {
  let depth = 0;
  const overlay = h("div", { class: "drop-overlay", "aria-hidden": "true" }, h("div", null, "Drop to add games"));
  document.body.append(overlay);
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e) || state.player) return;
    e.preventDefault();
    depth++;
    document.body.classList.add("dragging");
  });
  window.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) document.body.classList.remove("dragging");
  });
  // Without preventDefault on dragover AND drop, the browser would navigate
  // away from the arcade to the dropped file.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove("dragging");
    if (state.player) return;
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) void importFiles(files);
  });
}

function setupKeyboard(): void {
  document.addEventListener("keydown", (e) => {
    if (state.player || document.querySelector("dialog[open]")) return;
    const target = e.target as HTMLElement;
    const typing = target.matches("input, textarea");
    if (e.key === "/" && !typing) {
      const s = app.querySelector<HTMLInputElement>(".search input");
      if (s) {
        e.preventDefault();
        s.focus();
      }
      return;
    }
    if (!target.classList.contains("card")) return;
    const cards = [...app.querySelectorAll<HTMLElement>(".grid .card")];
    const i = cards.indexOf(target);
    if (i < 0) return;
    const top = cards[0].getBoundingClientRect().top;
    const cols = Math.max(1, cards.filter((c) => c.getBoundingClientRect().top === top).length);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + cols, ArrowUp: i - cols, Home: 0, End: cards.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    cards[Math.min(cards.length - 1, Math.max(0, next))]?.focus();
  });
}

// ------------------------------------------------------------------ go

document.documentElement.dataset.launcher = LAUNCHER_VERSION;
boot().catch((e) => {
  app.replaceChildren(
    h("main", { class: "main" }, h("div", { class: "notice", role: "alert" }, icon("alert"), h("div", null, "The arcade couldn't start in this browser. Try Chrome, Edge or Firefox.", h("details", null, h("summary", null, "Details"), h("pre", null, e instanceof Error ? e.message : String(e)))))),
  );
});
