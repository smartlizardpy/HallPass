"""Regression checks for the tiny-cutout bug and deterministic background removal."""
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from PIL import Image, ImageDraw

MODULE = Path(__file__).resolve().parents[1] / "prepare_assets.py"
spec = importlib.util.spec_from_file_location("prepare_assets", MODULE)
preparation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preparation)


class PreparationTests(unittest.TestCase):
    def test_pack_renderer_applies_scale_offsets_and_circle_clipping(self):
        cutout = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
        ImageDraw.Draw(cutout).rectangle((128, 128, 384, 384), fill="red")
        avatar = preparation.render_avatar(cutout, {"color": "#0000ff", "scale": .5, "x": .2, "y": .1})
        self.assertEqual(avatar.getpixel((0, 0))[3], 0)
        self.assertEqual(avatar.getpixel((350, 300)), (255, 0, 0, 255))
        self.assertEqual(avatar.getpixel((210, 256)), (0, 0, 255, 255))

    def test_small_original_is_scaled_and_centred_with_transparent_padding(self):
        image = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
        ImageDraw.Draw(image).ellipse((30, 10, 70, 90), fill=(210, 180, 100, 255))
        with TemporaryDirectory() as temporary:
            output = Path(temporary) / "prepared.png"
            preparation.prepare(image, output)
            result = Image.open(output)
            self.assertEqual(result.size, (512, 512))
            bounds = result.getchannel("A").point(lambda value: 255 if value > 24 else 0).getbbox()
            self.assertGreaterEqual(bounds[3] - bounds[1], 448)
            self.assertLessEqual(abs((bounds[0] + bounds[2]) / 2 - 256), 1)
            self.assertEqual(result.getpixel((0, 0))[3], 0)

    def test_background_removal_preserves_enclosed_matching_colour(self):
        image = Image.new("RGBA", (60, 60), (255, 0, 255, 255))
        draw = ImageDraw.Draw(image)
        draw.rectangle((10, 10, 50, 50), fill=(20, 100, 160, 255))
        draw.rectangle((20, 20, 30, 30), fill=(255, 0, 255, 255))
        result = preparation.remove_background(image, (255, 0, 255))
        self.assertEqual(result.getpixel((0, 0))[3], 0)
        self.assertEqual(result.getpixel((25, 25))[3], 255)
        self.assertEqual(result.getpixel((40, 40))[3], 255)

    def test_opaque_and_empty_images_are_rejected(self):
        with TemporaryDirectory() as temporary:
            for colour in [(10, 20, 30, 255), (0, 0, 0, 0)]:
                with self.assertRaises(ValueError):
                    preparation.prepare(Image.new("RGBA", (100, 100), colour), Path(temporary) / "invalid.png")


if __name__ == "__main__":
    unittest.main()
