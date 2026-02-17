"""Phase 0: Validate that card images are pixel-identical across captures."""
from PIL import Image
import os

CAPTURES_DIR = "test/captures"

# Load all captures
files = sorted(f for f in os.listdir(CAPTURES_DIR) if f.endswith(".png"))
images = [(f, Image.open(os.path.join(CAPTURES_DIR, f))) for f in files]

print(f"Loaded {len(images)} captures")
for f, img in images:
    print(f"  {f}: {img.size}")

# Hero cards are at bottom center. Let's crop that region from each image.
# Based on the screenshots (~800x450 visible), hero cards appear around:
# First let's check actual image dimensions
w, h = images[0][1].size
print(f"\nImage dimensions: {w}x{h}")

# Crop hero card regions - approximate positions based on table layout
# Hero's two cards are centered horizontally, roughly 55-60% down from top
# Let's extract a generous region around hero's cards
hero_region = (w*0.38, h*0.62, w*0.62, h*0.82)
hero_region = tuple(int(x) for x in hero_region)
print(f"Hero card region: {hero_region}")

# Save cropped hero cards from each capture
os.makedirs("test/card-crops", exist_ok=True)
for f, img in images:
    crop = img.crop(hero_region)
    out = os.path.join("test/card-crops", f"hero_{f}")
    crop.save(out)
    print(f"  Saved hero crop: {out} ({crop.size})")

# Also crop community cards from captures that have them
# Community cards are roughly centered, 30-40% down
comm_region = (w*0.28, h*0.28, w*0.72, h*0.42)
comm_region = tuple(int(x) for x in comm_region)
print(f"\nCommunity card region: {comm_region}")

for f, img in images:
    crop = img.crop(comm_region)
    out = os.path.join("test/card-crops", f"comm_{f}")
    crop.save(out)
    print(f"  Saved community crop: {out} ({crop.size})")

# Now compare: are identical cards pixel-identical?
# Crop individual hero cards (left and right)
print("\n--- Individual card crops ---")
# Split hero region into left card and right card
hero_w = hero_region[2] - hero_region[0]
mid = hero_region[0] + hero_w // 2

left_card = (hero_region[0], hero_region[1], mid, hero_region[3])
right_card = (mid, hero_region[1], hero_region[2], hero_region[3])

for f, img in images:
    left = img.crop(left_card)
    right = img.crop(right_card)
    left.save(os.path.join("test/card-crops", f"hero_L_{f}"))
    right.save(os.path.join("test/card-crops", f"hero_R_{f}"))

print("Individual hero card crops saved.")
print("\nNext step: visually inspect crops to refine regions, then test pixel comparison.")
