/* global AvatarCore, AvatarCatalogue, AvatarAssets */
(() => {
  "use strict";
  const core = AvatarCore, catalogue = AvatarCatalogue;
  const byId = id => document.getElementById(id);
  const images = new Map(), thumbs = new Map();
  const storageKey = "avatar-studio:choices:v2";
  let values = core.readProject({ version: 1, avatars: {} }, catalogue);
  let selected = catalogue[0].id, exporting = false, storageWarning = false;

  function announce(text, error = false) { byId("status").textContent = text; byId("status").classList.toggle("error", error); }
  function project() { return { version: 1, selectedAvatar: selected, avatars: values }; }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(project())); }
    catch { storageWarning = true; }
  }
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const restored = JSON.parse(saved);
      values = core.readProject(restored, catalogue);
      if (catalogue.some(item => item.id === restored.selectedAvatar)) selected = restored.selectedAvatar;
    }
  } catch { storageWarning = true; }

  const entry = () => catalogue.find(item => item.id === selected);
  function redraw(id) {
    const image = images.get(id);
    if (image && thumbs.has(id)) core.draw(thumbs.get(id), image, values[id], 128);
    if (id === selected && image) core.draw(byId("preview"), image, values[id]);
  }
  function updateControls() {
    const item = entry(), value = values[selected];
    byId("selected-name").textContent = item.name;
    byId("selected-category").textContent = item.category;
    byId("reference").href = item.reference;
    byId("colour").value = value.color;
    document.querySelectorAll(".swatch").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.colour === value.color)));
    byId("export-png").disabled = !images.has(selected) || exporting;
    byId("export-pack").disabled = images.size !== catalogue.length || exporting;
  }
  function select(id) {
    selected = id; persist();
    document.querySelectorAll(".face").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.id === id)));
    byId("preview").getContext("2d").clearRect(0, 0, 512, 512);
    updateControls(); redraw(id);
    announce(images.has(id) ? `${entry().name} selected.${storageWarning ? " Use Save project to keep your edits." : ""}` : "This avatar could not load. Please choose another face.", !images.has(id));
  }
  function change(patch) {
    values[selected] = { ...entry().defaults, color: core.settings(patch, values[selected]).color };
    persist(); updateControls(); redraw(selected);
  }
  for (const category of [...new Set(catalogue.map(item => item.category))]) {
    const option = document.createElement("option"); option.value = category; option.textContent = category; byId("category").append(option);
  }
  for (const item of catalogue) {
    const button = document.createElement("button"); button.type = "button"; button.className = "face"; button.dataset.id = item.id; button.setAttribute("aria-pressed", String(item.id === selected));
    const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 128; canvas.setAttribute("aria-hidden", "true"); thumbs.set(item.id, canvas);
    const label = document.createElement("span"); label.textContent = item.name; button.append(canvas, label); button.addEventListener("click", () => select(item.id)); byId("catalogue").append(button);
  }
  const colourNames = ["Lavender", "Coral", "Mint", "Sky", "Honey", "Pink", "Slate", "Cream"];
  core.palette.forEach((colour, index) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "swatch"; button.dataset.colour = colour; button.style.backgroundColor = colour; button.setAttribute("aria-label", `${colourNames[index]} background`); button.addEventListener("click", () => change({ color: colour })); byId("palette").append(button);
  });
  function filter() {
    const query = byId("search").value.toLocaleLowerCase().trim(), category = byId("category").value;
    let count = 0;
    catalogue.forEach(item => {
      const show = (category === "all" || item.category === category) && `${item.name} ${item.category} ${item.id}`.toLocaleLowerCase().includes(query);
      const button = byId("catalogue").querySelector(`[data-id="${item.id}"]`); button.hidden = !show; if (show) count++;
    });
    byId("count").textContent = `${count} ${count === 1 ? "face" : "faces"}`; byId("empty").hidden = count > 0;
  }
  byId("search").addEventListener("input", filter); byId("category").addEventListener("change", filter);
  byId("colour").addEventListener("input", event => change({ color: event.target.value }));
  byId("random-colour").addEventListener("click", () => {
    const alternatives = core.palette.filter(colour => colour !== values[selected].color);
    change({ color: alternatives[Math.floor(Math.random() * alternatives.length)] });
  });
  byId("reset").addEventListener("click", () => { values[selected] = { ...entry().defaults }; persist(); updateControls(); redraw(selected); });

  function download(blob, filename) {
    const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function png(canvas) { return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG export failed")), "image/png")); }
  function decode(src) { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("Image could not be decoded")); image.src = src; }); }
  byId("save-project").addEventListener("click", () => { download(new Blob([JSON.stringify(project(), null, 2)], { type: "application/json" }), "avatar-project.json"); announce("Choices saved. Avatar framing is fixed."); });
  byId("open-project").addEventListener("change", async event => {
    const file = event.target.files[0]; if (!file) return;
    try { if (file.size > 1024 * 1024) throw new Error("Project file is too large"); values = core.readProject(JSON.parse(await file.text()), catalogue); persist(); catalogue.forEach(item => redraw(item.id)); updateControls(); announce("Colours restored. Avatar framing is fixed."); }
    catch (error) { announce(error.message, true); }
    event.target.value = "";
  });
  byId("export-png").addEventListener("click", async () => {
    try { const id = selected, canvas = document.createElement("canvas"); core.draw(canvas, images.get(id), values[id]); download(await png(canvas), `${id}.png`); announce("PNG downloaded."); }
    catch (error) { announce(error.message, true); }
  });
  byId("export-pack").addEventListener("click", async () => {
    exporting = true; updateControls();
    try {
      const snapshot = core.readProject(project(), catalogue), imageSnapshot = new Map(images), encoder = new TextEncoder();
      const files = [{ name: "catalogue.json", data: encoder.encode(JSON.stringify(core.manifest(catalogue, snapshot), null, 2)) }];
      for (const [index, item] of catalogue.entries()) {
        announce(`Preparing ${index + 1} of ${catalogue.length}…`);
        const image = imageSnapshot.get(item.id), avatar = document.createElement("canvas"), cutout = document.createElement("canvas");
        core.draw(avatar, image, snapshot[item.id]); cutout.width = image.naturalWidth; cutout.height = image.naturalHeight; cutout.getContext("2d").drawImage(image, 0, 0);
        files.push({ name: `avatars/${item.id}.png`, data: new Uint8Array(await (await png(avatar)).arrayBuffer()) }, { name: `cutouts/${item.id}.png`, data: new Uint8Array(await (await png(cutout)).arrayBuffer()) });
      }
      download(new Blob([core.zip(files)], { type: "application/zip" }), "avatar-catalogue.zip"); announce("All 33 avatars, cutouts and the catalogue exported.");
    } catch (error) { announce(error.message, true); }
    finally { exporting = false; updateControls(); }
  });
  updateControls();
  Promise.allSettled(catalogue.map(async item => {
    const image = await decode(typeof AvatarAssets !== "undefined" && AvatarAssets[item.id] ? AvatarAssets[item.id] : item.src);
    images.set(item.id, image); redraw(item.id);
  })).then(results => {
    updateControls(); const failed = results.filter(result => result.status === "rejected").length;
    announce(failed ? `${failed} ${failed === 1 ? "avatar" : "avatars"} could not load. Please choose an available face.` : `All 33 faces ready.${storageWarning ? " Browser storage is unavailable; use Save project." : " Your colours are saved in this browser."}`, failed > 0);
  });
})();
