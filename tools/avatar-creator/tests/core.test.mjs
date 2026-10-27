import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { unzipSync } from "fflate";

const root = new URL("../", import.meta.url);
const context = vm.createContext({ TextEncoder, Uint8Array, DataView });
vm.runInContext(readFileSync(new URL("core.js", root), "utf8"), context);
vm.runInContext(readFileSync(new URL("catalogue.js", root), "utf8"), context);
const core = context.AvatarCore, catalogue = context.AvatarCatalogue;
const plain = value => JSON.parse(JSON.stringify(value));

test("catalogue contains all 33 unique agreed faces, one Jake and two Turkish entries", () => {
  assert.equal(catalogue.length, 33);
  assert.equal(new Set(catalogue.map(entry => entry.id)).size, 33);
  assert.equal(catalogue.filter(entry => entry.id === "jake-peralta").length, 1);
  assert.equal(catalogue.filter(entry => entry.category === "Turkish").length, 2);
  assert.equal(catalogue.filter(entry => entry.category === "Anime").length, 5);
  assert.equal(catalogue.filter(entry => entry.category === "Ghibli").length, 3);
});

test("catalogue preserves the owner's approved framing except the replaced Andy", () => {
  const approved = JSON.parse(readFileSync(new URL("approved-framing.json", root), "utf8")).avatars;
  for (const entry of catalogue) {
    if (entry.id !== "jake-peralta") assert.deepEqual(plain(entry.defaults), approved[entry.id]);
  }
});

test("project import locks approved framing and ignores unknown entries and invalid colours", () => {
  const values = core.readProject({ version: 1, avatars: { gigachad: { color: "red;evil", x: 100, y: -100, scale: Infinity }, attacker: { src: "evil" } } }, catalogue);
  assert.deepEqual(plain(values.gigachad), plain(catalogue[0].defaults));
  assert.equal(Object.keys(values).length, 33);
  assert.equal(values.attacker, undefined);
  assert.throws(() => core.readProject({ version: 9, avatars: {} }, catalogue));
});

test("image placement preserves aspect ratio and maps offsets to output size", () => {
  assert.deepEqual(plain(core.geometry(200, 100, 512, { scale: 1, x: 0, y: 0 })), { width: 512, height: 256, x: 0, y: 128 });
  assert.equal(core.geometry(100, 200, 512, { scale: 0.5, x: 0.25, y: 0 }).x, 320);
  assert.throws(() => core.geometry(0, 100, 512, { scale: 1 }));
});

test("export manifest preserves stable IDs and current edits", () => {
  const values = core.readProject({ version: 1, avatars: { jiji: { color: "#112233", scale: 1.2, x: 0.1, y: 0 } } }, catalogue);
  const output = core.manifest(catalogue, values);
  assert.equal(output.avatars.length, 33);
  assert.equal(output.avatars.find(entry => entry.id === "jiji").src, "avatars/jiji.png");
  assert.equal(output.avatars.find(entry => entry.id === "jiji").color, "#112233");
  assert.equal(output.avatars.find(entry => entry.id === "jiji").x, catalogue.find(entry => entry.id === "jiji").defaults.x);
});

test("ZIP opens with an independent decoder, including binary data and Unicode content", () => {
  const files = [{ name: "catalogue.json", data: '{"name":"Şaban"}' }, { name: "avatars/jiji.png", data: new Uint8Array([0, 255, 128, 1]) }];
  const archive = core.zip(files), unpacked = unzipSync(archive);
  assert.equal(new TextDecoder().decode(unpacked["catalogue.json"]), files[0].data);
  assert.deepEqual(Array.from(unpacked["avatars/jiji.png"]), [0, 255, 128, 1]);
  assert.equal(core.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.throws(() => core.zip([{ name: "../evil", data: "x" }]));
  assert.throws(() => core.zip([{ name: "a", data: "x" }, { name: "a", data: "y" }]));
});

test("renderer clips the background and portrait to a circle", () => {
  const calls = [];
  const painter = Object.fromEntries(["clearRect", "save", "beginPath", "arc", "clip", "fillRect", "drawImage", "restore"].map(name => [name, (...args) => calls.push([name, ...args])]));
  core.draw({ getContext: () => painter }, { naturalWidth: 512, naturalHeight: 512 }, catalogue[0].defaults);
  assert.ok(calls.findIndex(call => call[0] === "clip") < calls.findIndex(call => call[0] === "drawImage"));
  assert.deepEqual(calls.find(call => call[0] === "arc").slice(1, 4), [256, 256, 256]);
});

test("every catalogue entry points to a local prepared cutout", () => {
  for (const entry of catalogue) {
    assert.match(entry.src, /^assets\/[a-z0-9-]+\.png$/);
    assert.ok(fileURLToPath(new URL(entry.src, root)).endsWith(`${entry.id}.png`));
    const png = readFileSync(new URL(entry.src, root));
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), 512);
    assert.equal(png.readUInt32BE(20), 512);
    assert.equal(png[25], 6, "cutout must retain RGBA rather than an opaque RGB image");
  }
});
