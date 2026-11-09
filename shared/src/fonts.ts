export const FONTS = {
  Inter: { css: 'Inter Variable', weights: [400, 500, 600, 700, 800] },
  Montserrat: { css: 'Montserrat Variable', weights: [400, 500, 600, 700, 800] },
  Poppins: { css: 'Poppins', weights: [400, 600, 700] },
  'Playfair Display': { css: 'Playfair Display Variable', weights: [400, 600, 700, 800] },
  Oswald: { css: 'Oswald Variable', weights: [400, 500, 600, 700] },
} as const;

export type FontName = keyof typeof FONTS;
export const FONT_NAMES = Object.keys(FONTS) as FontName[];
export const DEFAULT_FONT: FontName = 'Inter';

export const isFontName = (value: string): value is FontName => value in FONTS;

export const cssFamily = (name: string | undefined) =>
  FONTS[isFontName(name ?? '') ? (name as FontName) : DEFAULT_FONT].css;
