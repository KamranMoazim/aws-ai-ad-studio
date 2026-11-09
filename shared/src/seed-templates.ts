import { SAMPLE_COLORS } from './blank.js';
import type { Box } from './crop.js';
import { DEFAULT_SAFE_ZONE, safeRect } from './safe-zone.js';
import { SIZE_KEYS, SIZES, STORY_SIZE, type SizeKey } from './sizes.js';
import type { Element, ElementStyle, Slot, Template } from './types.js';

type Shape = 'banner' | 'box' | 'tall';

interface Area {
  size: SizeKey;
  width: number;
  height: number;
  shape: Shape;
  content: Box;
  unit: number;
}

const r = (value: number) => Math.round(value);

function areaFor(size: SizeKey): Area {
  const { width, height } = SIZES[size];
  const shape: Shape = width / height >= 3 ? 'banner' : height / width >= 1.45 ? 'tall' : 'box';
  let content: Box;
  if (size === STORY_SIZE) {
    const safe = safeRect(width, height, DEFAULT_SAFE_ZONE);
    content = { x: safe.x + 8, y: safe.y + 8, width: safe.width - 16, height: safe.height - 16 };
  } else {
    const margin = shape === 'banner' ? height * 0.15 : Math.min(width, height) * 0.07;
    content = { x: margin, y: margin, width: width - margin * 2, height: height - margin * 2 };
  }
  return { size, width, height, shape, content, unit: Math.min(content.width, content.height) };
}

const frame = (x: number, y: number, w: number, h: number) => ({
  x: r(x),
  y: r(y),
  w: r(w),
  h: r(h),
});

function text(
  id: string,
  bind: string,
  box: ReturnType<typeof frame>,
  style: ElementStyle,
): Element {
  const fontSize = r(style.fontSize ?? 16);
  return {
    id,
    type: 'text',
    bind,
    frame: box,
    style: {
      fontFamily: 'Montserrat',
      minFontSize: Math.max(8, r(fontSize * 0.6)),
      ...style,
      fontSize,
    },
    locked: ['visible'],
    fit: 'shrink',
  };
}

function button(id: string, box: ReturnType<typeof frame>, style: ElementStyle): Element {
  const fontSize = r(box.h * 0.42);
  return {
    id,
    type: 'button',
    bind: 'cta',
    frame: box,
    style: {
      fontFamily: 'Montserrat',
      fontWeight: 700,
      fontSize,
      minFontSize: Math.max(8, r(fontSize * 0.5)),
      radius: r(box.h * 0.2),
      padding: r(box.h * 0.12),
      align: 'center',
      verticalAlign: 'middle',
      ...style,
    },
    locked: ['visible'],
    fit: 'shrink',
  };
}

const rect = (id: string, box: ReturnType<typeof frame>, style: ElementStyle): Element => ({
  id,
  type: 'rect',
  frame: box,
  style,
  locked: true,
});

const image = (
  id: string,
  bind: string,
  box: ReturnType<typeof frame>,
  crop: 'cover' | 'contain',
): Element => ({
  id,
  type: 'image',
  bind,
  frame: box,
  style: {},
  locked: ['visible'],
  crop,
});

const fullFrame = (area: Area) => frame(0, 0, area.width, area.height);

const textSlot = (
  key: string,
  label: string,
  required: boolean,
  maxLines: number,
  chars: number[],
): Slot => ({
  key,
  label,
  kind: 'text',
  required,
  limits: {
    maxLines,
    maxChars: Object.fromEntries(SIZE_KEYS.map((size, index) => [size, chars[index]])),
  },
});

// Per size, in SIZE_KEYS order: 300x250, 728x90, 300x600, 336x280, 320x50, then the 3 Meta sizes.
const HEADLINE = textSlot('headline', 'Headline', true, 3, [40, 40, 50, 45, 25, 60, 60, 60]);
const SUBHEAD = textSlot('subhead', 'Subheading', false, 2, [60, 60, 70, 60, 30, 90, 90, 90]);
const OFFER = textSlot('offer', 'Offer', false, 1, [20, 20, 20, 20, 12, 24, 24, 24]);
const CTA = textSlot('cta', 'Call to action', true, 1, [16, 16, 16, 16, 12, 18, 18, 18]);
const LOGO: Slot = { key: 'logo', label: 'Logo', kind: 'image', required: true };
const PHOTO: Slot = { key: 'photo', label: 'Photo', kind: 'image', required: true };

const SAMPLE_TEXTS = {
  headline: 'Fresh spring cleaning for every room',
  subhead: 'Trusted local team, flexible times',
  offer: '20% off',
  cta: 'Book now',
};
const SHORT_HEADLINE = { '320x50': { headline: 'Spring cleaning' } };

function boldOffer(area: Area): Element[] {
  const { content: c, unit } = area;
  const elements = [rect('background', fullFrame(area), { fill: 'color:primary' })];
  if (area.shape === 'banner') {
    elements.push(
      image('logo', 'logo', frame(c.x, c.y, c.width * 0.16, c.height), 'contain'),
      text('headline', 'headline', frame(c.x + c.width * 0.19, c.y, c.width * 0.5, c.height), {
        fontSize: c.height * 0.4,
        fontWeight: 700,
        color: 'color:text',
        verticalAlign: 'middle',
      }),
      button(
        'cta',
        frame(c.x + c.width * 0.72, c.y + c.height * 0.1, c.width * 0.28, c.height * 0.8),
        {
          fill: 'color:accent',
          color: 'color:primary',
        },
      ),
    );
    return elements;
  }
  const buttonHeight = unit * 0.17;
  elements.push(
    image('logo', 'logo', frame(c.x, c.y, c.width * 0.45, unit * 0.14), 'contain'),
    text('offer', 'offer', frame(c.x, c.y + c.height * 0.2, c.width, unit * 0.18), {
      fontSize: unit * 0.13,
      minFontSize: Math.max(8, r(unit * 0.06)),
      fontWeight: 800,
      color: 'color:accent',
      fontFamily: 'Oswald',
      uppercase: true,
    }),
    text('headline', 'headline', frame(c.x, c.y + c.height * 0.42, c.width, c.height * 0.34), {
      fontSize: unit * 0.09,
      fontWeight: 700,
      color: 'color:text',
    }),
    button('cta', frame(c.x, c.y + c.height - buttonHeight, c.width * 0.7, buttonHeight), {
      fill: 'color:accent',
      color: 'color:primary',
    }),
  );
  return elements;
}

function photoHero(area: Area): Element[] {
  const { content: c, unit } = area;
  if (area.shape === 'banner') {
    const photoWidth = area.width * 0.3;
    const inner = c.x + photoWidth;
    const room = c.x + c.width - inner;
    return [
      rect('background', fullFrame(area), { fill: 'color:primary' }),
      image('photo', 'photo', frame(0, 0, photoWidth, area.height), 'cover'),
      image('logo', 'logo', frame(c.x, c.y, photoWidth * 0.5, c.height), 'contain'),
      text('headline', 'headline', frame(inner, c.y, room * 0.6, c.height), {
        fontSize: c.height * 0.4,
        fontWeight: 700,
        color: 'color:text',
        verticalAlign: 'middle',
        fontFamily: 'Playfair Display',
      }),
      button('cta', frame(inner + room * 0.62, c.y + c.height * 0.1, room * 0.38, c.height * 0.8), {
        fill: 'color:accent',
        color: 'color:primary',
      }),
    ];
  }
  const buttonHeight = unit * 0.17;
  return [
    image('photo', 'photo', fullFrame(area), 'cover'),
    rect('shade', fullFrame(area), { fill: '#000000', opacity: 0.45 }),
    image('logo', 'logo', frame(c.x, c.y, c.width * 0.4, unit * 0.13), 'contain'),
    text('headline', 'headline', frame(c.x, c.y + c.height * 0.3, c.width, c.height * 0.32), {
      fontSize: unit * 0.1,
      fontWeight: 700,
      color: '#ffffff',
      fontFamily: 'Playfair Display',
    }),
    text('subhead', 'subhead', frame(c.x, c.y + c.height * 0.63, c.width, c.height * 0.14), {
      fontSize: unit * 0.055,
      color: '#ffffff',
      fontFamily: 'Inter',
    }),
    button('cta', frame(c.x, c.y + c.height - buttonHeight, c.width * 0.7, buttonHeight), {
      fill: 'color:accent',
      color: 'color:primary',
    }),
  ];
}

function splitPanel(area: Area): Element[] {
  const { content: c, unit } = area;
  const background = rect('background', fullFrame(area), { fill: 'color:background' });
  if (area.shape === 'banner') {
    const photoWidth = area.width * 0.28;
    const inner = photoWidth + c.x;
    const room = c.x + c.width - inner;
    return [
      background,
      image('photo', 'photo', frame(0, 0, photoWidth, area.height), 'cover'),
      image('logo', 'logo', frame(inner, c.y, room * 0.18, c.height), 'contain'),
      text('headline', 'headline', frame(inner + room * 0.21, c.y, room * 0.4, c.height), {
        fontSize: c.height * 0.4,
        fontWeight: 700,
        color: 'color:primary',
        verticalAlign: 'middle',
      }),
      button('cta', frame(inner + room * 0.63, c.y + c.height * 0.1, room * 0.37, c.height * 0.8), {
        fill: 'color:primary',
        color: 'color:background',
      }),
    ];
  }
  const photoShare = area.size === STORY_SIZE ? 0.42 : area.shape === 'tall' ? 0.45 : 0.48;
  const photoHeight = area.height * photoShare;
  const panelTop = Math.max(c.y, photoHeight + unit * 0.06);
  const panelHeight = c.y + c.height - panelTop;
  const buttonHeight = Math.min(unit * 0.17, panelHeight * 0.3);
  const elements = [
    background,
    image('photo', 'photo', frame(0, 0, area.width, photoHeight), 'cover'),
    image('logo', 'logo', frame(c.x, c.y, c.width * 0.36, unit * 0.12), 'contain'),
  ];
  const hasSubhead = panelHeight > 200;
  elements.push(
    text(
      'headline',
      'headline',
      frame(c.x, panelTop, c.width, panelHeight * (hasSubhead ? 0.45 : 0.62)),
      {
        fontSize: unit * 0.085,
        fontWeight: 700,
        color: 'color:primary',
      },
    ),
  );
  if (hasSubhead) {
    elements.push(
      text(
        'subhead',
        'subhead',
        frame(c.x, panelTop + panelHeight * 0.48, c.width, panelHeight * 0.2),
        {
          fontSize: unit * 0.05,
          color: '#333333',
          fontFamily: 'Inter',
        },
      ),
    );
  }
  elements.push(
    button('cta', frame(c.x, c.y + c.height - buttonHeight, c.width * 0.7, buttonHeight), {
      fill: 'color:primary',
      color: 'color:background',
    }),
  );
  return elements;
}

function seed(
  id: string,
  name: string,
  tags: string[],
  slots: Slot[],
  build: (area: Area) => Element[],
): Template {
  return {
    id,
    version: 0,
    name,
    channel: 'both',
    tags,
    colorRoles: ['primary', 'accent', 'text', 'background'],
    slots,
    layouts: Object.fromEntries(
      SIZE_KEYS.map((size) => {
        const area = areaFor(size);
        return [size, { width: area.width, height: area.height, elements: build(area) }];
      }),
    ),
    sample: {
      texts: { ...SAMPLE_TEXTS },
      textOverrides: SHORT_HEADLINE,
      images: {},
      colors: { ...SAMPLE_COLORS },
    },
  };
}

export const SEED_TEMPLATES: Template[] = [
  seed(
    'seed-bold-offer',
    'Bold Offer',
    ['promo', 'bold', 'flat'],
    [LOGO, HEADLINE, OFFER, CTA],
    boldOffer,
  ),
  seed(
    'seed-photo-hero',
    'Photo Hero',
    ['photo-led', 'bold'],
    [PHOTO, LOGO, HEADLINE, SUBHEAD, CTA],
    photoHero,
  ),
  seed(
    'seed-split-panel',
    'Split Panel',
    ['photo-led', 'clean'],
    [PHOTO, LOGO, HEADLINE, SUBHEAD, CTA],
    splitPanel,
  ),
];
