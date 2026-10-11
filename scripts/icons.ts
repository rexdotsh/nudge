import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const out = 'public/icons';

function icon({ radius, scale }: { radius: number; scale: number }): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff9a4d"/>
      <stop offset="1" stop-color="#ff3b47"/>
    </linearGradient>
    <radialGradient id="shine" cx="0.25" cy="0.15" r="0.8">
      <stop offset="0" stop-color="#fff" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" rx="${radius}" fill="url(#bg)"/>
  <rect width="1024" height="1024" rx="${radius}" fill="url(#shine)"/>
  <g transform="translate(512 512) scale(${scale}) translate(-570 -500)" fill="#fff">
    <g transform="rotate(-16 512 480)">
      <circle cx="512" cy="214" r="38"/>
      <path d="M512 232C404 232 336 318 336 424V560C336 616 312 652 276 688H748C712 652 688 616 688 560V424C688 318 620 232 512 232Z"/>
      <rect x="250" y="672" width="524" height="60" rx="30"/>
      <circle cx="512" cy="782" r="58"/>
    </g>
    <g fill="none" stroke="#fff" stroke-linecap="round" stroke-width="46">
      <path d="M760 292A236 236 0 0 1 812 478"/>
      <path d="M842 226A330 330 0 0 1 912 486" stroke-opacity="0.55"/>
    </g>
  </g>
</svg>`;
}

const rounded = icon({ radius: 228, scale: 0.86 });
const bleed = icon({ radius: 0, scale: 0.86 });
const maskable = icon({ radius: 0, scale: 0.7 });

mkdirSync(out, { recursive: true });
writeFileSync(`${out}/icon.svg`, rounded);

const render = (svg: string, size: number, name: string) =>
  sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(`${out}/${name}`);

await Promise.all([
  render(rounded, 192, 'icon-192.png'),
  render(rounded, 512, 'icon-512.png'),
  render(maskable, 512, 'maskable-512.png'),
  render(bleed, 180, 'apple-touch-icon.png'),
]);
