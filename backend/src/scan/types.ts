export interface LogoCandidate {
  kind: 'img' | 'svg-inline' | 'css' | 'icon' | 'meta';
  src?: string;
  markup?: string;
  alt?: string;
  hint?: string;
  width: number;
  height: number;
  top: number;
  left: number;
  inHeader: boolean;
  linksHome: boolean;
  hasLogoWord: boolean;
}

export interface ColorSample {
  role:
    | 'button-bg'
    | 'button-text'
    | 'link'
    | 'header-bg'
    | 'body-bg'
    | 'body-text'
    | 'heading'
    | 'css-var';
  color: string;
  weight: number;
}

export interface PageImage {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export interface CapturedPage {
  url: string;
  title: string;
  meta: Record<string, string>;
  jsonLd: string[];
  logoCandidates: LogoCandidate[];
  textLogo?: string;
  colors: ColorSample[];
  fonts: Record<string, string>;
  headings: string[];
  text: string;
  ctas: string[];
  images: PageImage[];
  navLinks: Array<{ href: string; text: string }>;
}

export interface SiteCapture {
  startUrl: string;
  pages: Array<CapturedPage & { screenshotKey?: string }>;
  failedPages: string[];
}
