"""Generate the PWA icons.

One-time tool, not part of the build: the PNGs it writes are committed, so CI
never needs Pillow. Re-run it only if the mark changes.

    python packages/web/scripts/make-icons.py

The mark mirrors `packages/dsh-plugin/icon.svg` — a rounded green square with
three white lines, which is what the memo list looks like.

Everything is drawn at 4x and downscaled with LANCZOS: Pillow's line and
rounded-rectangle drawing is aliased, and a favicon is exactly the size where
that shows.
"""

from pathlib import Path

from PIL import Image, ImageDraw

GREEN = (24, 160, 88, 255)
WHITE = (255, 255, 255, 255)
SUPERSAMPLE = 4

OUT = Path(__file__).resolve().parent.parent / "public"


def draw(size: int, *, rounded: bool, inset_ratio: float) -> Image.Image:
    """Draw the mark at `size`, supersampled."""
    big = size * SUPERSAMPLE
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw_ctx = ImageDraw.Draw(image)

    if rounded:
        draw_ctx.rounded_rectangle(
            [0, 0, big - 1, big - 1], radius=int(big * 0.22), fill=GREEN
        )
    else:
        # Full bleed: the platform applies its own mask, and a maskable icon must
        # not have transparent corners or it gets letterboxed.
        draw_ctx.rectangle([0, 0, big, big], fill=GREEN)

    inset = big * inset_ratio
    left = inset
    right = big - inset
    stroke = max(1, round(big * 0.055))

    # Three rules, the last one shorter — the same shape as the sidebar glyph.
    for offset, fraction in ((0.375, 1.0), (0.5, 1.0), (0.625, 0.58)):
        y = big * offset
        draw_ctx.line(
            [left, y, left + (right - left) * fraction, y],
            fill=WHITE,
            width=stroke,
        )

    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    targets = [
        ("icon-192.png", 192, True, 0.24),
        ("icon-512.png", 512, True, 0.24),
        # Maskable icons keep their content inside the inner 80% circle, so the
        # mark is inset further and the background runs to the edges.
        ("icon-maskable-512.png", 512, False, 0.30),
        # iOS ignores the manifest and reads this one, and masks the corners
        # itself.
        ("apple-touch-icon.png", 180, False, 0.26),
        ("favicon-32.png", 32, True, 0.24),
    ]

    for name, size, rounded, inset in targets:
        image = draw(size, rounded=rounded, inset_ratio=inset)
        path = OUT / name
        image.save(path, "PNG", optimize=True)
        print(f"{path.relative_to(OUT.parent.parent.parent)}  {size}x{size}  {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
