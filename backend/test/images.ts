import sharp from 'sharp';

export async function testPhoto(width = 1600, height = 1000): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let index = 0; index < pixels.length; index += 3) {
    const x = (index / 3) % width;
    const y = Math.floor(index / 3 / width);
    const grain = Math.floor(random() * 60);
    pixels[index] = Math.min(255, (x / width) * 180 + grain);
    pixels[index + 1] = Math.min(255, (y / height) * 160 + 40 + grain);
    pixels[index + 2] = Math.min(255, 210 - (x / width) * 120 + grain);
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .withExif({ IFD0: { Copyright: 'test camera owner' } })
    .toBuffer();
}

export function testLogo(): Promise<Buffer> {
  return sharp({
    create: { width: 400, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="400" height="120"><rect x="10" y="10" width="380" height="100" rx="20" fill="#f2a541"/><circle cx="70" cy="60" r="30" fill="#1f3a5f"/></svg>',
        ),
      },
    ])
    .png()
    .toBuffer();
}
