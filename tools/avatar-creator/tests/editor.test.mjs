import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const root = new URL("../", import.meta.url);
async function open({ broken = false, saved = null } = {}) {
  const dom = new JSDOM(readFileSync(new URL("index.html", root), "utf8"), { url: "https://avatar-studio.test/", runScripts: "outside-only" });
  const { window } = dom;
  window.TextEncoder = TextEncoder;
  if (saved) window.localStorage.setItem("avatar-studio:choices:v2", JSON.stringify(saved));
  window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, save() {}, beginPath() {}, arc() {}, clip() {}, fillRect() {}, drawImage() {}, restore() {} });
  window.Image = class {
    naturalWidth = 512;
    naturalHeight = 512;
    set src(value) { queueMicrotask(() => broken && value.includes("jiji") ? this.onerror() : this.onload()); }
  };
  for (const name of ["catalogue.js", "core.js", "editor.js"]) window.eval(readFileSync(new URL(name, root), "utf8"));
  await new Promise(resolve => setImmediate(resolve));
  return dom;
}

test("all 33 decoded faces enable single and pack exports", async () => {
  const dom = await open(), document = dom.window.document;
  assert.equal(document.querySelectorAll(".face").length, 33);
  assert.equal(document.getElementById("export-png").disabled, false);
  assert.equal(document.getElementById("export-pack").disabled, false);
  assert.match(document.getElementById("status").textContent, /All 33 faces ready/);
  dom.window.close();
});

test("filtering and selecting a Turkish face updates the editor and selected state", async () => {
  const dom = await open(), { document, Event } = dom.window;
  const category = document.getElementById("category"); category.value = "Turkish"; category.dispatchEvent(new Event("change"));
  const visible = [...document.querySelectorAll(".face")].filter(button => !button.hidden);
  assert.equal(visible.length, 2);
  visible[0].click();
  assert.match(document.getElementById("selected-name").textContent, /Şaban/);
  assert.equal(document.querySelectorAll('.face[aria-pressed="true"]').length, 1);
  assert.equal(document.getElementById("reference").href, dom.window.AvatarCatalogue.find(entry => entry.id === "saban").reference);
  dom.window.close();
});

test("only avatar and colour are editable; legacy placement cannot override framing", async () => {
  const dom = await open({ saved: { version: 1, selectedAvatar: "gigachad", avatars: { gigachad: { color: "#112233", scale: 2, x: .5, y: -.5 } } } });
  const { document, Event, localStorage, AvatarCatalogue } = dom.window;
  const defaults = AvatarCatalogue[0].defaults;
  for (const id of ["scale", "x", "y", "replace"]) assert.equal(document.getElementById(id), null);
  document.querySelector('.swatch[data-colour="#ffb49c"]').click();
  let saved = JSON.parse(localStorage.getItem("avatar-studio:choices:v2"));
  assert.deepEqual(saved.avatars.gigachad, { ...defaults, color: "#ffb49c" });
  const preview = document.getElementById("preview");
  preview.dispatchEvent(new Event("pointerdown")); preview.dispatchEvent(new Event("pointermove"));
  assert.equal(localStorage.getItem("avatar-studio:choices:v2"), JSON.stringify(saved));
  document.querySelector('[data-id="jiji"]').click();
  assert.equal(JSON.parse(localStorage.getItem("avatar-studio:choices:v2")).selectedAvatar, "jiji");
  document.querySelector('[data-id="gigachad"]').click();
  assert.equal(document.getElementById("colour").value, "#ffb49c");
  document.getElementById("reset").click();
  saved = JSON.parse(localStorage.getItem("avatar-studio:choices:v2"));
  assert.deepEqual(saved.avatars.gigachad, JSON.parse(JSON.stringify(defaults)));
  dom.window.close();
});

test("a missing image prevents incomplete pack export but leaves other faces usable", async () => {
  const dom = await open({ broken: true }), document = dom.window.document;
  assert.equal(document.getElementById("export-pack").disabled, true);
  assert.equal(document.getElementById("export-png").disabled, false);
  assert.match(document.getElementById("status").textContent, /1 avatar could not load/);
  document.querySelector('[data-id="jiji"]').click();
  assert.equal(document.getElementById("export-png").disabled, true);
  assert.ok(document.getElementById("status").classList.contains("error"));
  dom.window.close();
});
