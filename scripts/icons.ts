import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { SPLASH_IMAGES } from './splash';

const out = 'public/icons';

function icon({ radius, scale }: { radius: number; scale: number }): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="${radius}" fill="#111110"/>
  <g transform="translate(512 512) scale(${scale})">
    <circle r="330" fill="none" stroke="#ff8a65" stroke-opacity="0.28" stroke-width="14"/>
    <circle r="210" fill="none" stroke="#ff8a65" stroke-opacity="0.55" stroke-width="14"/>
    <circle r="96" fill="#ff8a65"/>
  </g>
</svg>`;
}

const rounded = icon({ radius: 228, scale: 0.86 });
const bleed = icon({ radius: 0, scale: 0.86 });
const maskable = icon({ radius: 0, scale: 0.7 });

mkdirSync(out, { recursive: true });
mkdirSync('public/splash', { recursive: true });
writeFileSync(`${out}/icon.svg`, rounded);

const render = (svg: string, size: number, name: string) =>
  sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(`${out}/${name}`);

await Promise.all([
  render(rounded, 192, 'icon-192.png'),
  render(rounded, 512, 'icon-512.png'),
  render(maskable, 512, 'maskable-512.png'),
  render(bleed, 180, 'apple-touch-icon.png'),
  ...SPLASH_IMAGES.map(({ href, width, height }) =>
    sharp({ create: { width, height, channels: 3, background: '#111110' } })
      .png({ palette: true, compressionLevel: 9 })
      .toFile(`public${href}`),
  ),
]);
