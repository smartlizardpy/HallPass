/** Pure rendering geometry, project validation and dependency-free ZIP export. */
(() => {
  const palette = ["#c5b8ff", "#ffb49c", "#a5decf", "#a9d3f5", "#ffd982", "#f3add5", "#b5bdc9", "#eee9db"];
  const numeric = (value, fallback, min, max) => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

  function settings(input, defaults) {
    const source = input && typeof input === "object" ? input : {};
    return {
      color: /^#[0-9a-f]{6}$/i.test(source.color || "") ? source.color : defaults.color,
      scale: numeric(source.scale, defaults.scale, 0.4, 2),
      x: numeric(source.x, defaults.x, -0.5, 0.5),
      y: numeric(source.y, defaults.y, -0.5, 0.5),
    };
  }

  function geometry(width, height, size, value) {
    if (!(width > 0 && height > 0 && size > 0)) throw new Error("Invalid image dimensions");
    const ratio = size / Math.max(width, height) * value.scale;
    const w = width * ratio, h = height * ratio;
    return { width: w, height: h, x: (size - w) / 2 + value.x * size, y: (size - h) / 2 + value.y * size };
  }

  function draw(canvas, image, value, size = 512) {
    canvas.width = size; canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser does not support canvas");
    context.clearRect(0, 0, size, size);
    context.save();
    context.beginPath(); context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); context.clip();
    context.fillStyle = value.color; context.fillRect(0, 0, size, size);
    const box = geometry(image.naturalWidth || image.width, image.naturalHeight || image.height, size, value);
    context.drawImage(image, box.x, box.y, box.width, box.height);
    context.restore();
  }

  function readProject(raw, catalogue) {
    if (!raw || raw.version !== 1 || !raw.avatars || typeof raw.avatars !== "object" || Array.isArray(raw.avatars)) throw new Error("Choose an Avatar Studio project (version 1)");
    const result = {};
    for (const entry of catalogue) {
      const value = settings(raw.avatars[entry.id], entry.defaults);
      result[entry.id] = { ...entry.defaults, color: value.color };
    }
    return result;
  }

  function manifest(catalogue, values) {
    return {
      version: 1, size: 512, shape: "circle", transparentCorners: true,
      avatars: catalogue.map(entry => ({
        id: entry.id, name: entry.name, category: entry.category, reference: entry.reference,
        src: `avatars/${entry.id}.png`, cutout: `cutouts/${entry.id}.png`,
        ...entry.defaults, color: settings(values[entry.id], entry.defaults).color,
      })),
    };
  }

  // Stored ZIP entries keep the offline tool independent of a CDN or bundler.
  const crcTable = Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function zip(files) {
    if (files.length > 65535) throw new Error("Too many ZIP entries");
    const encoder = new TextEncoder(), local = [], central = [];
    let offset = 0, centralSize = 0;
    const names = new Set();
    for (const file of files) {
      if (!/^[a-zA-Z0-9._/-]+$/.test(file.name) || file.name.startsWith("/") || file.name.split("/").includes("..") || names.has(file.name)) throw new Error("Unsafe or duplicate ZIP filename");
      names.add(file.name);
      const name = encoder.encode(file.name), data = file.data instanceof Uint8Array ? file.data : encoder.encode(file.data);
      const crc = crc32(data);
      const header = new Uint8Array(30 + name.length), view = new DataView(header.buffer);
      view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
      view.setUint16(12, 33, true); view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, name.length, true); header.set(name, 30);
      local.push(header, data);
      const record = new Uint8Array(46 + name.length), cv = new DataView(record.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
      cv.setUint16(14, 33, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); record.set(name, 46);
      central.push(record); centralSize += record.length; offset += header.length + data.length;
    }
    const end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
    const result = new Uint8Array(offset + centralSize + end.length);
    let cursor = 0;
    for (const part of [...local, ...central, end]) { result.set(part, cursor); cursor += part.length; }
    return result;
  }

  globalThis.AvatarCore = { palette, settings, geometry, draw, readProject, manifest, crc32, zip };
})();
