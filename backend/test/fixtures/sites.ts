import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

export interface SiteExpectation {
  name: string;
  logoMarker: string;
  primary: string;
  accent: string;
  offers: string[];
  services: string[];
  hard?: string;
}

interface SiteSpec extends SiteExpectation {
  business: string;
  headerLogo: (business: string) => string;
  headerBackground: string;
  headerText: string;
  dark?: boolean;
  extraHead?: string;
  footer?: string;
  offerPage?: string;
  logoFile?: { name: string; svg: string; format: 'png' | 'svg' };
}

const logoSvg = (business: string, color: string, accent: string, textColor = color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="96" viewBox="0 0 360 96"><rect x="4" y="16" width="64" height="64" rx="14" fill="${accent}"/><circle cx="36" cy="48" r="18" fill="${color}"/><text x="84" y="60" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="${textColor}">${business.replace(/&/g, '&amp;')}</text></svg>`;

const SITES: SiteSpec[] = [
  {
    name: 'bakery',
    business: "Rosie's Bakery",
    logoMarker: 'rosie-logo.png',
    primary: '#8b3a3a',
    accent: '#f4b942',
    headerBackground: '#8b3a3a',
    headerText: '#ffffff',
    offers: ['20% off birthday cakes this month'],
    services: ['Birthday cakes', 'Sourdough bread'],
    logoFile: { name: 'rosie-logo.png', svg: logoSvg("Rosie's", '#8b3a3a', '#f4b942', '#ffffff'), format: 'png' },
    headerLogo: () => '<a href="index.html"><img src="rosie-logo.png" alt="Rosie\'s Bakery logo" width="180" height="48"></a>',
    offerPage: '<h1>Offers</h1><p>This month only: 20% off birthday cakes this month when you order online.</p>',
  },
  {
    name: 'plumbing',
    business: 'FlowRight Plumbing',
    logoMarker: 'flowright-mark',
    primary: '#0a4f9e',
    accent: '#ff7a00',
    headerBackground: '#ffffff',
    headerText: '#0a4f9e',
    offers: ['Free call-out on weekdays'],
    services: ['Leak repair', 'Boiler servicing'],
    headerLogo: () =>
      '<a href="index.html" class="logo" aria-label="FlowRight Plumbing home"><svg id="flowright-mark" width="200" height="48" viewBox="0 0 200 48"><path d="M10 40 Q24 4 38 40 Z" fill="#0a4f9e"/><text x="48" y="32" font-size="20" fill="#0a4f9e">FlowRight</text></svg></a>',
    offerPage: '<h1>Special offers</h1><p>Free call-out on weekdays for all new customers.</p>',
  },
  {
    name: 'dental',
    business: 'Bright Smile Dental',
    logoMarker: 'brightsmile-brand.png',
    primary: '#0f766e',
    accent: '#22c55e',
    headerBackground: '#ffffff',
    headerText: '#0f766e',
    offers: [],
    services: ['Check-ups', 'Teeth whitening'],
    logoFile: { name: 'brightsmile-brand.png', svg: logoSvg('Bright Smile', '#0f766e', '#22c55e'), format: 'png' },
    extraHead: '<meta property="og:logo" content="brightsmile-brand.png">',
    headerLogo: () => '<a href="./"><img class="brand-mark" src="brightsmile-brand.png" alt="Bright Smile Dental" width="190" height="50"></a>',
  },
  {
    name: 'gym',
    business: 'Iron Pulse Gym',
    logoMarker: 'ironpulse-logo.png',
    primary: '#111827',
    accent: '#e11d48',
    headerBackground: '#111827',
    headerText: '#ffffff',
    dark: true,
    offers: ['First week free'],
    services: ['Personal training', 'HIIT classes'],
    hard: 'logo drawn as a CSS background',
    logoFile: { name: 'ironpulse-logo.png', svg: logoSvg('Iron Pulse', '#111827', '#e11d48', '#ffffff'), format: 'png' },
    headerLogo: () =>
      '<a href="index.html" class="site-logo" style="display:block;width:180px;height:48px;background:url(ironpulse-logo.png) no-repeat left center/contain" aria-label="Iron Pulse Gym"></a>',
    offerPage: '<h1>Join today</h1><p>Try us out: First week free, no contract needed.</p>',
  },
  {
    name: 'florist',
    business: 'Petal & Stem',
    logoMarker: 'petal-icon.png',
    primary: '#6d28d9',
    accent: '#f472b6',
    headerBackground: '#faf5ff',
    headerText: '#6d28d9',
    offers: [],
    services: ['Wedding flowers', 'Same-day bouquets'],
    hard: 'text-only logo; only an app icon image exists',
    logoFile: { name: 'petal-icon.png', svg: logoSvg('P&S', '#6d28d9', '#f472b6'), format: 'png' },
    extraHead: '<link rel="apple-touch-icon" sizes="180x180" href="petal-icon.png">',
    headerLogo: () => '<a href="index.html" class="logo-text" style="font-size:28px;font-weight:700;text-decoration:none;color:#6d28d9">Petal &amp; Stem</a>',
  },
  {
    name: 'cafe',
    business: 'Grind House Cafe',
    logoMarker: 'grind-mark.svg',
    primary: '#3f2a1d',
    accent: '#d97706',
    headerBackground: '#fffaf3',
    headerText: '#3f2a1d',
    offers: ['Buy 9 coffees, get the 10th free'],
    services: ['Espresso bar', 'Breakfast'],
    logoFile: { name: 'grind-mark.svg', svg: logoSvg('Grind House', '#3f2a1d', '#d97706'), format: 'svg' },
    headerLogo: () => '<a href="/"><img src="grind-mark.svg" alt="Grind House" width="180" height="48"></a>',
    offerPage: '<h1>Loyalty</h1><p>Our loyalty card: Buy 9 coffees, get the 10th free.</p>',
  },
  {
    name: 'law',
    business: 'Hart & Cole Solicitors',
    logoMarker: 'hartcole-logo.png',
    primary: '#1e293b',
    accent: '#b45309',
    headerBackground: '#1e293b',
    headerText: '#ffffff',
    offers: [],
    services: ['Conveyancing', 'Family law'],
    logoFile: { name: 'hartcole-logo.png', svg: logoSvg('Hart & Cole', '#1e293b', '#b45309', '#ffffff'), format: 'png' },
    headerLogo: () => '<a href="index.html"><img src="hartcole-logo.png" alt="Hart and Cole logo" width="200" height="54"></a>',
    footer:
      '<div class="awards"><img src="award-logo.png" alt="Law Society award logo" width="120" height="60"><img src="partner-logo.png" alt="Partner logo" width="120" height="60"></div>',
  },
  {
    name: 'salon',
    business: 'Glow Salon',
    logoMarker: 'glow-logo.png',
    primary: '#db2777',
    accent: '#0ea5e9',
    headerBackground: '#ffffff',
    headerText: '#db2777',
    offers: ['15% off your first visit'],
    services: ['Haircuts', 'Colour'],
    logoFile: { name: 'glow-logo.png', svg: logoSvg('Glow', '#db2777', '#0ea5e9'), format: 'png' },
    extraHead: '<meta name="theme-color" content="#db2777">',
    headerLogo: () => '<a href="index.html"><img src="glow-logo.png" alt="Glow Salon" width="160" height="44"></a>',
    offerPage: '<h1>Pricing</h1><p>New clients get 15% off your first visit. Cuts from $45.</p>',
  },
  {
    name: 'landscaping',
    business: 'Greenline Landscapes',
    logoMarker: 'greenline-logo.png',
    primary: '#14532d',
    accent: '#84cc16',
    headerBackground: '#14532d',
    headerText: '#ffffff',
    offers: [],
    services: ['Garden design', 'Lawn care'],
    hard: 'white logo on a dark header',
    logoFile: { name: 'greenline-logo.png', svg: logoSvg('Greenline', '#ffffff', '#84cc16', '#ffffff'), format: 'png' },
    headerLogo: () => '<a href="index.html"><img src="greenline-logo.png" alt="Greenline Landscapes" width="190" height="50"></a>',
  },
  {
    name: 'repair',
    business: 'FixIt Tech Repair',
    logoMarker: 'fixit-mark',
    primary: '#1d4ed8',
    accent: '#facc15',
    headerBackground: '#ffffff',
    headerText: '#1d4ed8',
    offers: ['10% student discount'],
    services: ['Phone screen repair', 'Laptop repair'],
    headerLogo: () =>
      '<a href="/"><svg id="fixit-mark" width="170" height="44" viewBox="0 0 170 44"><rect x="2" y="6" width="32" height="32" rx="6" fill="#facc15"/><text x="42" y="30" font-size="20" fill="#1d4ed8">FixIt</text></svg></a>',
    offerPage: '<h1>Discounts</h1><p>Show your card for a 10% student discount on any repair.</p>',
  },
];

function page(spec: SiteSpec, title: string, body: string): string {
  const links = [
    ['index.html', 'Home'],
    ['services.html', 'Services'],
    ...(spec.offerPage ? [['offers.html', 'Offers']] : []),
    ['about.html', 'About us'],
    ['contact.html', 'Contact'],
  ];
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} | ${spec.business}</title>
<meta name="description" content="${spec.business}: ${spec.services.join(', ')}">${spec.extraHead ?? ''}
<style>
:root { --brand-primary: ${spec.primary}; --brand-accent: ${spec.accent}; }
body { margin: 0; font-family: Arial, sans-serif; background: ${spec.dark ? '#0b0f17' : '#ffffff'}; color: ${spec.dark ? '#e5e7eb' : '#1f2937'}; }
header { display: flex; align-items: center; gap: 24px; padding: 16px 32px; background: ${spec.headerBackground}; }
header nav a { color: ${spec.headerText}; margin-right: 16px; text-decoration: none; }
h1, h2 { color: ${spec.dark ? '#ffffff' : spec.primary}; }
main { padding: 32px; }
.btn { display: inline-block; padding: 12px 24px; border-radius: 8px; background: var(--brand-accent); color: ${spec.dark ? '#ffffff' : '#111111'}; text-decoration: none; font-weight: 700; }
footer { padding: 24px 32px; background: ${spec.dark ? '#000000' : '#f3f4f6'}; margin-top: 1400px; }
img.photo { width: 600px; height: 400px; object-fit: cover; display: block; margin: 16px 0; }
</style></head><body>
<header>${spec.headerLogo(spec.business)}<nav>${links.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}</nav></header>
<main>${body}<p><a class="btn" href="contact.html">Book now</a> <a class="btn" href="contact.html">Get a quote</a></p></main>
<footer>${spec.footer ?? ''}<p>&copy; ${spec.business}</p></footer></body></html>`;
}

async function photo(seed: number): Promise<Buffer> {
  const width = 1200;
  const height = 800;
  const pixels = Buffer.alloc(width * height * 3);
  for (let index = 0; index < pixels.length; index += 3) {
    const x = (index / 3) % width;
    const y = Math.floor(index / 3 / width);
    pixels[index] = (x * (seed + 1) * 0.15 + y * 0.05) % 256;
    pixels[index + 1] = (y * 0.2 + seed * 40) % 256;
    pixels[index + 2] = (200 - x * 0.1 + seed * 25) % 256;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 82 }).toBuffer();
}

export async function buildSites(root: string): Promise<SiteExpectation[]> {
  const badge = await sharp(Buffer.from(logoSvg('Award', '#999999', '#cccccc'))).png().toBuffer();
  for (const [index, spec] of SITES.entries()) {
    const dir = join(root, spec.name);
    mkdirSync(dir, { recursive: true });
    if (spec.logoFile) {
      const body =
        spec.logoFile.format === 'svg'
          ? Buffer.from(spec.logoFile.svg)
          : await sharp(Buffer.from(spec.logoFile.svg)).png().toBuffer();
      writeFileSync(join(dir, spec.logoFile.name), body);
    }
    writeFileSync(join(dir, 'award-logo.png'), badge);
    writeFileSync(join(dir, 'partner-logo.png'), badge);
    writeFileSync(join(dir, 'photo-1.jpg'), await photo(index * 3));
    writeFileSync(join(dir, 'photo-2.jpg'), await photo(index * 3 + 1));
    writeFileSync(join(dir, 'photo-3.jpg'), await photo(index * 3 + 2));
    const services = spec.services.map((service) => `<h2>${service}</h2><p>Professional ${service.toLowerCase()} by our experienced local team.</p>`).join('');
    writeFileSync(
      join(dir, 'index.html'),
      page(spec, 'Home', `<h1>${spec.business}</h1><p>Welcome to ${spec.business}, proudly serving the community.</p><img class="photo" src="photo-1.jpg" alt="Our shop"><img class="photo" src="photo-2.jpg" alt="Our work">`),
    );
    writeFileSync(join(dir, 'services.html'), page(spec, 'Services', `<h1>Our services</h1>${services}<img class="photo" src="photo-3.jpg" alt="Service in progress">`));
    writeFileSync(join(dir, 'about.html'), page(spec, 'About us', `<h1>About ${spec.business}</h1><p>Family owned for over ten years. We care about every customer.</p>`));
    writeFileSync(join(dir, 'contact.html'), page(spec, 'Contact', '<h1>Contact</h1><p>Call us or send a message any time.</p>'));
    if (spec.offerPage) {
      writeFileSync(join(dir, 'offers.html'), page(spec, 'Offers', spec.offerPage));
    }
  }
  return SITES.map(({ name, logoMarker, primary, accent, offers, services, hard }) => ({
    name,
    logoMarker,
    primary,
    accent,
    offers,
    services,
    hard,
  }));
}
