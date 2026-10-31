from pathlib import Path

from PIL import Image

root = Path(r"C:\work\ebid\.codex\ego-spic-avc-20261030")
background = Image.open(root / "current-background.png").convert("RGB").resize((139, 75))
block = Image.open(root / "current-block.png").convert("RGBA").resize((32, 75))
alpha = block.getchannel("A")
mask_bbox = alpha.getbbox()
template = block.crop(mask_bbox)
template_alpha = alpha.crop(mask_bbox)
template_pixels = template.load()
template_alpha_pixels = template_alpha.load()
template_width, template_height = template.size

background_pixels = background.load()
bg_width, bg_height = background.size
results = []
for y in range(bg_height - template_height + 1):
    for x in range(bg_width - template_width + 1):
        total = 0
        count = 0
        for ty in range(template_height):
            for tx in range(template_width):
                if template_alpha_pixels[tx, ty] == 0:
                    continue
                bg_pixel = background_pixels[x + tx, y + ty]
                template_pixel = template_pixels[tx, ty]
                total += abs(bg_pixel[0] - template_pixel[0]) + abs(bg_pixel[1] - template_pixel[1]) + abs(bg_pixel[2] - template_pixel[2])
                count += 1
        results.append((total / count, x, y))

results.sort()
print({"shape": background.size, "bbox": mask_bbox, "template": template.size, "best": results[:20]})
