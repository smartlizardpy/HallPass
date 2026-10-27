#!/usr/bin/env python3
"""Download recorded original images; discovery mode finds candidate source URLs.

No generated images are used. Downloads remain separate from subject preparation
so a reviewer can check the exact source and crop before background removal.
"""
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
import json
from pathlib import Path
import requests
from PIL import Image, ImageDraw
from io import BytesIO

ROOT = Path(__file__).resolve().parent


class Pictures(HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta = []
        self.images = []

    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        if tag == "meta" and data.get("property") == "og:image":
            self.meta.append(data.get("content"))
        if tag == "img":
            src = data.get("data-src") or data.get("src")
            if src:
                self.images.append({"src": src, "alt": data.get("alt", ""), "class": data.get("class", "")})


def discover(item):
    response = requests.get(item["page"], timeout=25, headers={"User-Agent": "Mozilla/5.0"})
    response.raise_for_status()
    parser = Pictures()
    parser.feed(response.text)
    candidates = [image for image in parser.images if any(domain in image["src"] for domain in ["kym-cdn", "i.imgflip", "ghibli.jp/gallery", "media.tenor", "haberturk"]) ]
    return {"id": item["id"], "meta": parser.meta, "candidates": candidates[:60]}


def download(item):
    if not item.get("image"):
        raise ValueError(f"{item['id']}: choose a source image first")
    response = requests.get(item["image"], timeout=30, headers={"User-Agent": "Mozilla/5.0"})
    response.raise_for_status()
    if len(response.content) > 20 * 1024 * 1024:
        raise ValueError("Source image exceeds 20 MB")
    path = ROOT / "originals" / f"{item['id']}.source"
    path.parent.mkdir(exist_ok=True)
    path.write_bytes(response.content)
    return {"id": item["id"], "bytes": len(response.content)}


def review_ghibli():
    """Contact sheets of the official stills, used to select a clean face crop."""
    folder = ROOT / ".work"
    folder.mkdir(exist_ok=True)
    rows = json.loads((ROOT / "source-candidates.json").read_text())
    for row in rows:
        if row["id"] not in ("totoro", "jiji", "no-face"):
            continue
        def thumb(candidate):
            response = requests.get(candidate["src"], timeout=20)
            response.raise_for_status()
            return Image.open(BytesIO(response.content)).convert("RGB")
        with ThreadPoolExecutor(max_workers=8) as pool:
            images = list(pool.map(thumb, row["candidates"]))
        sheet = Image.new("RGB", (8 * 160, 7 * 114), "white")
        draw = ImageDraw.Draw(sheet)
        for i, image in enumerate(images):
            image.thumbnail((154, 90))
            x, y = (i % 8) * 160, (i // 8) * 114
            sheet.paste(image, (x, y))
            draw.text((x + 4, y + 91), str(i + 1), fill="black")
        sheet.save(folder / f"{row['id']}-references.jpg")
        print(f"Reviewed official stills for {row['id']}", flush=True)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--discover", action="store_true")
    parser.add_argument("--review-ghibli", action="store_true")
    args = parser.parse_args()
    if args.review_ghibli:
        review_ghibli()
        raise SystemExit(0)
    items = json.loads((ROOT / "sources.json").read_text())["avatars"]
    operation = discover if args.discover else download
    def run(item):
        try:
            return operation(item)
        except Exception as error:
            return {"id": item["id"], "error": str(error)}
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(run, items))
    if args.discover:
        (ROOT / "source-candidates.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
        print(json.dumps([{ "id": row["id"], "meta": row.get("meta"), "candidates": len(row.get("candidates", [])), "error": row.get("error") } for row in results], ensure_ascii=False))
    else:
        print(json.dumps(results, ensure_ascii=False))
        if any("error" in row for row in results):
            raise SystemExit(1)
