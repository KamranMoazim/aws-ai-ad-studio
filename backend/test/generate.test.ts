import {
  contrastRatio,
  resolveColor,
  SEED_TEMPLATES,
  type Template,
} from '../../shared/src/index.js';
import type { Asset, BrandKit } from '../src/core/schemas.js';
import { assignColors, assignImages } from '../src/generate/assign.js';
import { claimProblems } from '../src/generate/claims.js';
import { channelFits, fillable, pickTemplates } from '../src/generate/pick.js';
import { applyCopy, confirmProblems, problemsOf } from '../src/generate/variant.js';
import { extensionFor } from '../src/media/image-service.js';
import { check, finish } from './helpers.js';

const facts = ["Rosie's Bakery", 'Birthday cakes', '20% off birthday cakes this month', 'Book now'];
check(
  'a number from the offer is allowed',
  claimProblems('20% off birthday cakes', facts).length === 0,
);
check(
  'an invented percentage is flagged',
  claimProblems('30% off everything', facts).some((problem) => problem.value === '30'),
);
check(
  'an invented price is flagged',
  claimProblems('Cakes from $19', facts).some((problem) => problem.value === '$'),
);
check(
  '"free" without a free offer is flagged',
  claimProblems('Free delivery today', facts).some((problem) => problem.value === 'free'),
);
check(
  'superlatives are flagged',
  claimProblems('The best cakes in town', facts).some((problem) => problem.value === 'best'),
);
check(
  'banned phrases are flagged',
  claimProblems('Guaranteed results, risk-free', facts).some(
    (problem) => problem.kind === 'banned',
  ),
);
check('plain copy passes', claimProblems('Fresh cakes for every celebration', facts).length === 0);
check('[confirm] is never flagged', claimProblems('[confirm] off', facts).length === 0);
check(
  'words containing a claim word are not flagged',
  claimProblems('Office treats and offerings', facts).length === 0,
);

const template = structuredClone(SEED_TEMPLATES[0]) as Template;
const content = applyCopy(
  template,
  {
    slots: [
      {
        key: 'headline',
        text: 'Fresh birthday cakes baked to order',
        shorter: [
          { size: '320x50', text: 'Fresh cakes' },
          { size: '999x1', text: 'x' },
        ],
      },
      { key: 'cta', text: 'Book now', shorter: [] },
    ],
  },
  { images: {}, colors: template.sample.colors },
);
check(
  'copy fills slots and keeps valid per-size overrides',
  content.texts.headline.startsWith('Fresh') &&
    content.textOverrides?.['320x50']?.headline === 'Fresh cakes' &&
    !('999x1' in (content.textOverrides ?? {})),
);
check(
  'a missing optional slot stays empty and a missing required slot becomes [confirm]',
  content.texts.offer === '' && content.texts.cta === 'Book now',
);

const headline = template.layouts['300x250']!.elements.find(
  (element) => element.bind === 'headline',
)!;
const problems = problemsOf(
  template,
  { ...content, texts: { ...content.texts, offer: '50% off today' } },
  [
    {
      code: 'overflow',
      severity: 'error',
      size: '300x250',
      elementId: headline.id,
      message: 'overflows',
    },
  ],
  facts,
);
check(
  'fit issues map to their slot and size',
  problems.some((problem) => problem.slot === 'headline' && problem.size === '300x250'),
);
check(
  'claims map to their slot',
  problems.some((problem) => problem.slot === 'offer' && problem.message.includes('claim')),
);
const fixed = confirmProblems(
  { ...content, texts: { ...content.texts, offer: '50% off today' } },
  problems,
);
check(
  'fit problems become [confirm] for that size only; claims for every size',
  fixed.content.textOverrides?.['300x250']?.headline === '[confirm]' &&
    fixed.content.texts.headline.startsWith('Fresh') &&
    fixed.content.texts.offer === '[confirm]',
  fixed.content,
);

const kit: BrandKit = {
  kitId: 'k1',
  clientId: 'c1',
  name: "Rosie's",
  colors: { primary: '#8b3a3a', accent: '#f4b942', text: '#8b3a3a', background: '#ffffff' },
  logoLightId: 'logo-light',
  logoDarkId: 'logo-dark',
  photoIds: ['wide', 'tall'],
  services: [],
  offers: [],
  ctas: [],
  updatedAt: '',
  updatedBy: '',
};
const colors = assignColors(template, kit);
const headlineColor = resolveColor('color:text', colors);
check(
  'text colour that fails contrast on the brand background is fixed',
  contrastRatio(headlineColor, colors.primary!) >= 4.5,
  colors,
);
const asset = (
  assetId: string,
  width: number,
  height: number,
  kind: Asset['kind'] = 'photo',
): Asset => ({
  assetId,
  clientId: 'c1',
  kind,
  name: assetId,
  status: 'ready',
  key: `assets/c1/${assetId}.jpg`,
  width,
  height,
  focalX: 0.4,
  focalY: 0.3,
  createdAt: '',
  createdBy: '',
});
const assets = [
  asset('wide', 1600, 900),
  asset('tall', 900, 1600),
  asset('logo-light', 400, 120, 'logo'),
  asset('logo-dark', 400, 120, 'logo'),
];
const images = assignImages(template, kit, assets, colors);
check(
  'the logo on a dark header uses the dark-background logo',
  images.logo?.src === 'assets/c1/logo-dark.jpg',
  images,
);
const photoTemplate = structuredClone(SEED_TEMPLATES[1]) as Template;
const photoImages = assignImages(photoTemplate, kit, assets, assignColors(photoTemplate, kit));
check('photos keep their focal point', photoImages.photo?.focalX === 0.4);

const context = { kit, photos: assets.filter((item) => item.kind === 'photo'), hasLogo: true };
check(
  'display-only templates do not fit a both-channel brief',
  !channelFits({ ...template, channel: 'display' } as Template, 'both'),
);
check('photo-led templates need photos', !fillable(photoTemplate, { ...context, photos: [] }));
const picked = pickTemplates(
  SEED_TEMPLATES,
  {
    brandKitId: 'k1',
    channel: 'both',
    quality: 'final',
    offerText: '20% off',
    notes: 'bold promo',
  },
  context,
);
check(
  'three templates are picked, offer-ready ones first',
  picked.length === 3 && picked[0].id === 'seed-bold-offer',
  picked.map((item) => item.id),
);
check(
  'without photos only templates that need none are picked',
  pickTemplates(
    SEED_TEMPLATES,
    { brandKitId: 'k1', channel: 'both', quality: 'final' },
    { ...context, photos: [] },
  ).every((item) => item.id === 'seed-bold-offer'),
);

const wide = extensionFor(1536, 864, 9 / 16);
check(
  'landscape to 9:16 extends up and down',
  wide.left === 0 && Math.abs(1536 / (864 + wide.up + wide.down) - 9 / 16) < 0.01 && wide.up > 0,
  wide,
);
const tall = extensionFor(600, 1000, 1);
check(
  'portrait to square extends left and right',
  tall.up === 0 && 600 + tall.left + tall.right === 1000,
  tall,
);
check(
  'extensions are capped',
  extensionFor(1536, 100, 9 / 16).up + extensionFor(1536, 100, 9 / 16).down <= 4000,
);
finish();
