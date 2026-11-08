"""把品牌 Logo 处理成可直接用于深色界面的版本。

原图是「绿色圆 + 镂空的 P」：P 的位置 alpha=0，白底预览时才显示为白色。
直接放到深色界面上，P 会露出背景色，标识就散了。这里把镂空区补白，
同时保留圆形边缘的原始抗锯齿。

用法：python scripts/prepare_logo.py <输入.png> <输出目录>
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw


def build(source: Path, target: Path) -> None:
    image = Image.open(source).convert("RGBA")
    width, height = image.size

    # 先铺一层白底做合成，镂空处因此得到白色
    flat = Image.new("RGBA", (width, height), (255, 255, 255, 255))
    flat.alpha_composite(image)

    # 从四角洪水填充「外部透明区」，剩下的 alpha=0 就是 P 的镂空
    transparent = image.getchannel("A").point(lambda value: 255 if value == 0 else 0)
    for corner in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
        ImageDraw.floodfill(transparent, corner, 128)

    outside = transparent.load()
    original_alpha = image.getchannel("A").load()
    pixels = flat.load()
    assert outside and original_alpha and pixels

    for y in range(height):
        for x in range(width):
            marker = outside[x, y]
            if marker == 128:
                # 圆外：完全透明
                pixels[x, y] = (0, 0, 0, 0)
            elif marker == 255:
                # 镂空：补白
                pixels[x, y] = (255, 255, 255, 255)
            else:
                # 圆形边缘：沿用原始 alpha，保留抗锯齿
                red, green, blue, _ = pixels[x, y]
                pixels[x, y] = (red, green, blue, original_alpha[x, y])

    target.parent.mkdir(parents=True, exist_ok=True)
    flat.save(target, "PNG")

    # 应用内图标尺寸多样，额外产出一个 64px 版本给托盘/任务栏用
    flat.resize((64, 64), Image.LANCZOS).save(target.with_name("logo-64.png"), "PNG")
    print(f"已生成 {target}（{width}x{height}）与 64px 版本")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("用法：python scripts/prepare_logo.py <输入.png> <输出目录>")
    build(Path(sys.argv[1]), Path(sys.argv[2]) / "logo.png")
