#!/usr/bin/env python3
"""Remove original image backgrounds with Python and prepare centred PNGs.

Use --all for the recorded original sources (rembg + Pillow), --key for flat
backgrounds, --verify for alpha checks, and --bundle for offline browser assets.
"""

import argparse
from collections import deque
import json
import base64
import os
import tempfile
from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent


def remove_background(image, key, tolerance=36):
    """Remove only key-coloured pixels connected to the image border."""
    image = image.convert("RGBA")
    pixels = image.load()
    width, height = image.size
    visited = bytearray(width * height)
    queue = deque([(x, 0) for x in range(width)] + [(x, height - 1) for x in range(width)]
                  + [(0, y) for y in range(height)] + [(width - 1, y) for y in range(height)])
    while queue:
        x, y = queue.popleft()
        offset = y * width + x
        if visited[offset]:
            continue
        visited[offset] = 1
        rgba = pixels[x, y]
        if max(abs(rgba[i] - key[i]) for i in range(3)) > tolerance:
            continue
        pixels[x, y] = (*rgba[:3], 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height and not visited[ny * width + nx]:
                queue.append((nx, ny))
    return image


def prepare(source, destination, key=None):
    if isinstance(source, Image.Image):
        image = source.convert("RGBA")
    else:
        with Image.open(source) as original:
            image = original.convert("RGBA")
    if key:
        image = remove_background(image, key)
    alpha = image.getchannel("A")
    low, high = alpha.getextrema()
    if low != 0 or high < 200:
        raise ValueError("Expected a visible subject and genuinely transparent background; use --key for a flat background")
    # Ignore almost-transparent stray pixels when computing the visible bounds.
    bounds = alpha.point(lambda value: 255 if value > 12 else 0).getbbox()
    if not bounds:
        raise ValueError("The image contains no visible subject")
    cutout = image.crop(bounds)
    # Scale small originals too: thumbnail() only shrinks and produced specks.
    ratio = 450 / max(cutout.size)
    cutout = cutout.resize((round(cutout.width * ratio), round(cutout.height * ratio)), Image.Resampling.LANCZOS)
    result = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    result.alpha_composite(cutout, ((512 - cutout.width) // 2, (512 - cutout.height) // 2))
    destination.parent.mkdir(parents=True, exist_ok=True)
    result.save(destination, optimize=True)
    return destination


def verify():
    expected = [item["id"] for item in json.loads((ROOT / "sources.json").read_text())["avatars"]]
    failures = []
    for avatar_id in expected:
        path = ROOT / "assets" / f"{avatar_id}.png"
        try:
            with Image.open(path) as image:
                if image.mode != "RGBA" or image.size != (512, 512):
                    raise ValueError("expected 512×512 RGBA")
                alpha = image.getchannel("A")
                if alpha.getextrema() != (0, 255):
                    raise ValueError("missing transparency or opaque subject")
                corners = [alpha.getpixel(point) for point in [(0, 0), (511, 0), (0, 511), (511, 511)]]
                if any(corners):
                    raise ValueError("opaque outer corners")
                bounds = alpha.point(lambda value: 255 if value > 24 else 0).getbbox()
                if not bounds or max(bounds[2] - bounds[0], bounds[3] - bounds[1]) < 400:
                    raise ValueError("subject is too small in the canvas")
                visible = sum(1 for value in alpha.getdata() if value > 128) / (512 * 512)
                if visible < 0.14:
                    raise ValueError(f"subject coverage is too low ({visible:.1%}); inspect the mask")
                if ImageChops.invert(alpha).getbbox() is None:
                    raise ValueError("no transparent pixels")
        except (OSError, ValueError) as error:
            failures.append(f"{avatar_id}: {error}")
    if failures:
        raise SystemExit("\n".join(failures))
    print(f"Verified {len(expected)} transparent 512×512 cutouts")


def prepare_all(model="birefnet-general", ids=None, provider="cpu"):
    from rembg import new_session, remove
    import onnxruntime as ort
    import numpy as np
    from scipy import ndimage
    # Keep the reusable segmentation weights out of the repo and user's home.
    os.environ.setdefault("U2NET_HOME", str(Path(tempfile.gettempdir()) / "hallpass-avatar-models"))
    options = ort.SessionOptions()
    options.intra_op_num_threads = 8
    options.inter_op_num_threads = 1
    # CPU avoids CoreML's long model compilation; CoreML remains opt-in.
    requested = ["CoreMLExecutionProvider", "CPUExecutionProvider"] if provider == "coreml" else ["CPUExecutionProvider"]
    providers = [name for name in requested if name in ort.get_available_providers()]
    session = new_session(model, sess_opts=options, providers=providers)
    items = json.loads((ROOT / "sources.json").read_text())["avatars"]
    failures = []
    for item in items:
        if ids and item["id"] not in ids:
            continue
        try:
            with Image.open(ROOT / "originals" / f"{item['id']}.source") as original:
                original.seek(item.get("frame", 0))
                image = original.convert("RGBA")
            if item.get("crop"):
                x0, y0, x1, y1 = item["crop"]
                image = image.crop((int(x0 * image.width), int(y0 * image.height), int(x1 * image.width), int(y1 * image.height)))
            image.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
            if item.get("mask"):
                # A reviewed hand-traced outline preserves the original pixels
                # when automatic segmentation cannot understand a cartoon.
                factor = 4
                mask = Image.new("L", (image.width * factor, image.height * factor), 0)
                points = [(round(x * mask.width), round(y * mask.height)) for x, y in item["mask"]]
                ImageDraw.Draw(mask).polygon(points, fill=255)
                mask = mask.resize(image.size, Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(0.45))
                image.putalpha(ImageChops.multiply(image.getchannel("A"), mask))
            elif item.get("key"):
                key = tuple(int(item["key"][i:i+2], 16) for i in (0, 2, 4))
                image = remove_background(image, key)
            elif image.getchannel("A").getextrema()[0] > 0:
                image = remove(image, session=session)
            alpha = image.getchannel("A").point(lambda value: 0 if value < 10 else 255 if value > 245 else value)
            # Caption letters and incidental props must not survive as islands.
            array = np.asarray(alpha).copy()
            labels, count = ndimage.label(array > 24)
            if count:
                sizes = np.bincount(labels.ravel())
                sizes[0] = 0
                # Keep significant disconnected pieces, not just one blob.
                keep = sizes >= max(24, sizes.max() * 0.015)
                keep[0] = False
                foreground = ndimage.binary_dilation(keep[labels], iterations=2)
                array[~foreground] = 0
                alpha = Image.fromarray(array)
            image.putalpha(alpha)
            prepare(image, ROOT / "assets" / f"{item['id']}.png")
            print(f"Prepared {item['id']}", flush=True)
        except Exception as error:
            failures.append(f"{item['id']}: {error}")
    if failures:
        raise SystemExit("\n".join(failures))


def render_avatar(cutout, value, size=512):
    """Match the browser geometry, including approved scale and offsets."""
    factor = 4
    working_size = size * factor
    ratio = working_size / max(cutout.size) * value["scale"]
    width, height = round(cutout.width * ratio), round(cutout.height * ratio)
    image = cutout.resize((width, height), Image.Resampling.LANCZOS)
    x = round((working_size - width) / 2 + value["x"] * working_size)
    y = round((working_size - height) / 2 + value["y"] * working_size)
    avatar = Image.new("RGBA", (working_size, working_size), value["color"])
    avatar.alpha_composite(image, (x, y))
    circle = Image.new("L", avatar.size, 0)
    ImageDraw.Draw(circle).ellipse((0, 0, working_size - 1, working_size - 1), fill=255)
    avatar.putalpha(ImageChops.multiply(avatar.getchannel("A"), circle))
    return avatar.resize((size, size), Image.Resampling.LANCZOS)


def bundle():
    verify()
    items = json.loads((ROOT / "sources.json").read_text())["avatars"]
    data = {item["id"]: "data:image/png;base64," + base64.b64encode((ROOT / "assets" / f"{item['id']}.png").read_bytes()).decode("ascii") for item in items}
    (ROOT / "asset-data.js").write_text("/* eslint-disable */\n/* Python-generated offline assets. Originals and sources are recorded separately. */\nglobalThis.AvatarAssets = " + json.dumps(data, separators=(",", ":")) + ";\n")
    html = (ROOT / "index.html").read_text()
    html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>' + (ROOT / "styles.css").read_text() + '</style>')
    scripts = []
    for name in ["catalogue.js", "asset-data.js", "core.js", "editor.js"]:
        html = html.replace(f'  <script defer src="{name}"></script>\n', "")
        scripts.append((ROOT / name).read_text())
    html = html.replace("</body>", "<script>\n" + "\n".join(scripts) + "\n</script>\n</body>")
    (ROOT / "avatar-studio.html").write_text(html)
    sheet = Image.new("RGB", (6 * 180, 6 * 200), "#f7f5f0")
    draw = ImageDraw.Draw(sheet)
    catalogue_text = (ROOT / "catalogue.js").read_text()
    entries = json.loads(catalogue_text[catalogue_text.index("["):].strip().removesuffix(";"))
    defaults = {entry["id"]: entry["defaults"] for entry in entries}
    for i, item in enumerate(items):
        cutout = Image.open(ROOT / "assets" / f"{item['id']}.png").convert("RGBA")
        image = render_avatar(cutout, defaults[item["id"]], 144)
        x, y = (i % 6) * 180, (i // 6) * 200
        sheet.paste(image, (x + 18, y + 10), image)
        draw.text((x + 8, y + 166), item["id"], fill="#242222", font=ImageFont.load_default())
    sheet.save(ROOT / "contact-sheet.jpg", quality=90)
    build_default_pack()
    print("Bundled offline assets, standalone HTML, contact sheet and default ZIP")


def build_default_pack():
    text = (ROOT / "catalogue.js").read_text()
    entries = json.loads(text[text.index("["):].strip().removesuffix(";"))
    output = {"version": 1, "size": 512, "shape": "circle", "transparentCorners": True, "avatars": []}
    with ZipFile(ROOT / "avatar-catalogue.zip", "w", ZIP_DEFLATED) as archive:
        for entry in entries:
            cutout = Image.open(ROOT / entry["src"]).convert("RGBA")
            avatar = render_avatar(cutout, entry["defaults"])
            content = BytesIO(); avatar.save(content, format="PNG", optimize=True)
            archive.writestr(f"avatars/{entry['id']}.png", content.getvalue())
            archive.writestr(f"cutouts/{entry['id']}.png", (ROOT / entry["src"]).read_bytes())
            output["avatars"].append({key: entry[key] for key in ["id", "name", "category", "reference"]} | {
                "src": f"avatars/{entry['id']}.png", "cutout": f"cutouts/{entry['id']}.png", **entry["defaults"],
            })
        archive.writestr("catalogue.json", json.dumps(output, ensure_ascii=False, indent=2))
        archive.writestr("sources.json", (ROOT / "sources.json").read_text())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?")
    parser.add_argument("destination", nargs="?")
    parser.add_argument("--key", help="Flat background hex colour, for example FF00FF")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--bundle", action="store_true")
    parser.add_argument("--model", default="birefnet-general")
    parser.add_argument("--ids", help="Comma-separated IDs for a targeted quality check")
    parser.add_argument("--provider", choices=["cpu", "coreml"], default="cpu")
    args = parser.parse_args()
    if args.all:
        prepare_all(args.model, set(args.ids.split(",")) if args.ids else None, args.provider)
    elif args.bundle:
        bundle()
    elif args.verify:
        verify()
    else:
        if not args.source or not args.destination:
            parser.error("source and destination are required unless using --verify")
        raw = args.key.lstrip("#") if args.key else None
        if raw and (len(raw) != 6 or any(char not in "0123456789abcdefABCDEF" for char in raw)):
            parser.error("--key must contain six hex digits")
        key = tuple(int(raw[i:i + 2], 16) for i in (0, 2, 4)) if raw else None
        print(prepare(Path(args.source), Path(args.destination), key))
