"""Check the native ghost GPU captures (requires Pillow and NumPy)."""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

captures = Path(__file__).resolve().parents[1] / "captures"
report = {}

def read(name):
    return np.asarray(Image.open(captures / name).convert("RGB"), dtype=np.float32)

def cyan(image):
    return (image[:, :, 1] > 130) & (image[:, :, 2] > 160) & (image[:, :, 0] < 130)

for mode in ("taa", "fsr2"):
    report[mode] = {}
    for variant in ("before", "after"):
        if not (captures / f"ghost-raster-{variant}-{mode}-0.png").exists():
            continue
        frames = [read(f"ghost-raster-{variant}-{mode}-{i}.png") for i in range(12)]
        masks = [cyan(frame) for frame in frames]
        band = np.asarray(Image.fromarray(masks[0].astype("uint8") * 255).filter(ImageFilter.MaxFilter(7))) > 0
        difference = [np.abs(frames[i + 1] - frames[i])[band].mean() for i in range(11)]
        boundaries = [np.count_nonzero((masks[i] ^ masks[i + 1]) & band) for i in range(11)]
        clear = read(f"ghost-occluder-{variant}-{mode}.png")
        red = (clear[:, :, 0] > 170) & (clear[:, :, 1] < 110) & (clear[:, :, 2] < 110)
        # Ignore silhouette antialiasing: assert inside the opaque surface.
        interior = np.asarray(Image.fromarray(red.astype("uint8") * 255).filter(ImageFilter.MinFilter(7))) > 0
        result = {"meanFrameDifference8bit": round(float(np.mean(difference)), 4),
                  "meanCyanBoundaryChanges": round(float(np.mean(boundaries)), 2),
                  "cyanPixelsOnOccluder": int(np.count_nonzero(masks[-1] & interior)),
                  "occluderInteriorPixels": int(np.count_nonzero(interior)),
                  "ghostPixels": int(masks[0].sum())}
        report[mode][variant] = result
    after = report[mode]["after"]
    assert after["ghostPixels"] > 500, "Fixture must contain visible ghost outlines"
    assert after["occluderInteriorPixels"] > 500, "Occluder must be visible"
    assert after["cyanPixelsOnOccluder"] == 0, "Ghost paints over an opaque object"
    assert after["meanFrameDifference8bit"] < 1.5, "Static ghost edges visibly shimmer"
    if "before" in report[mode]:
        assert after["meanFrameDifference8bit"] < report[mode]["before"]["meanFrameDifference8bit"]
(captures / "ghost-raster-analysis.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
