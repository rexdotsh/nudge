// iOS shows a Home Screen app's launch image only when its pixel size matches the screen exactly, so every iPhone
// size gets one per orientation. Sizes are CSS pixels at the device pixel ratio.
const SCREENS = [
  { width: 360, height: 780, ratio: 3 },
  { width: 375, height: 667, ratio: 2 },
  { width: 375, height: 812, ratio: 3 },
  { width: 390, height: 844, ratio: 3 },
  { width: 393, height: 852, ratio: 3 },
  { width: 402, height: 874, ratio: 3 },
  { width: 414, height: 896, ratio: 2 },
  { width: 414, height: 896, ratio: 3 },
  { width: 420, height: 912, ratio: 3 },
  { width: 428, height: 926, ratio: 3 },
  { width: 430, height: 932, ratio: 3 },
  { width: 440, height: 956, ratio: 3 },
];

export const SPLASH_IMAGES = SCREENS.flatMap(({ width, height, ratio }) =>
  (['portrait', 'landscape'] as const).map((orientation) => {
    const [across, down] = orientation === 'portrait' ? [width, height] : [height, width];
    return {
      href: `/splash/${across * ratio}x${down * ratio}.png`,
      width: across * ratio,
      height: down * ratio,
      media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation})`,
    };
  }),
);
