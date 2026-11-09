import {
  adaptLayout,
  blankTemplate,
  checkContent,
  containBox,
  contrastRatio,
  coverCrop,
  DEFAULT_SAFE_ZONE,
  fitText,
  hasErrors,
  lintTemplate,
  SEED_TEMPLATES,
  SIZE_KEYS,
  SIZES,
  sizesForChannel,
  validateTemplate,
  wrapText,
  type FontSpec,
  type Template,
} from '../../shared/src/index.js';
import { check, finish } from './helpers.js';

const measure = (text: string, font: FontSpec) =>
  Array.from(text).length * (font.size * 0.6 + font.letterSpacing);
const font: FontSpec = { family: 'Inter', weight: 400, size: 10, letterSpacing: 0 };
const clone = <T>(value: T): T => structuredClone(value);

check('8 sizes', SIZE_KEYS.length === 8);
check(
  'channel sizes',
  sizesForChannel('display').length === 5 && sizesForChannel('meta').length === 3,
);

check(
  'wrap breaks on spaces',
  JSON.stringify(wrapText('aaa bbb ccc', 42, measure, font)) === JSON.stringify(['aaa bbb', 'ccc']),
  wrapText('aaa bbb ccc', 42, measure, font),
);
check(
  'wrap breaks a long word',
  wrapText('abcdefghij', 30, measure, font).every((line) => measure(line, font) <= 30),
);
check(
  'wrap keeps cjk within width',
  wrapText('\u3053\u3093\u306b\u3061\u306f\u4e16\u754c\u3067\u3059', 30, measure, font).length ===
    2,
);
check('wrap keeps explicit newlines', wrapText('a\nb', 100, measure, font).length === 2);

const base = {
  width: 60,
  height: 24,
  family: 'Inter',
  weight: 400,
  fontSize: 20,
  minFontSize: 8,
  lineHeight: 1,
  letterSpacing: 0,
  maxLines: 2,
  mode: 'shrink' as const,
};
const shrunk = fitText({ ...base, text: 'Spring sale now' }, measure);
check('shrink finds a smaller size that fits', shrunk.fits && shrunk.fontSize < 20, shrunk);
const overflow = fitText({ ...base, minFontSize: 18, text: 'Spring sale now on' }, measure);
check(
  'shrink reports overflow at the minimum',
  !overflow.fits && overflow.fontSize === 18,
  overflow,
);
const clamped = fitText({ ...base, mode: 'clamp', text: 'one two three four five six' }, measure);
check(
  'clamp truncates with an ellipsis',
  clamped.truncated && clamped.lines.at(-1)!.endsWith('...'),
  clamped,
);
check('empty text fits', fitText({ ...base, text: '  ' }, measure).fits);

const image = { width: 1600, height: 900 };
const crops = SIZE_KEYS.map((size) => {
  const { width, height } = SIZES[size];
  return {
    size,
    crop: coverCrop(image.width, image.height, width, height, 0.9, 0.1),
    width,
    height,
  };
});
check(
  'cover crop matches every aspect and stays inside the image',
  crops.every(
    ({ crop, width, height }) =>
      Math.abs(crop.width / crop.height - width / height) < 0.01 &&
      crop.x >= 0 &&
      crop.y >= 0 &&
      crop.x + crop.width <= image.width + 0.001 &&
      crop.y + crop.height <= image.height + 0.001,
  ),
  crops,
);
const centered = coverCrop(1000, 1000, 100, 50, 0.5, 0.5);
check('cover crop centers on the focal point', centered.y === 250 && centered.x === 0, centered);
const contained = containBox(200, 100, 100, 100);
check('contain fits and centers', contained.width === 100 && contained.y === 25, contained);

check('white on black is 21:1', Math.round(contrastRatio('#ffffff', '#000000')) === 21);
check('mid grey on white is below AA', contrastRatio('#777777', '#ffffff') < 4.5);

for (const template of SEED_TEMPLATES) {
  const issues = validateTemplate(template);
  check(`seed ${template.name} is valid`, issues.length === 0, issues.slice(0, 3));
  const lint = lintTemplate(template, { safeZone: DEFAULT_SAFE_ZONE, measure });
  check(
    `seed ${template.name} lints clean`,
    !hasErrors(lint),
    lint.filter((issue) => issue.severity === 'error').slice(0, 4),
  );
}
check(
  'blank template is valid',
  validateTemplate(blankTemplate('t1', 'Blank', 'both')).length === 0,
);

const seed = SEED_TEMPLATES[0];
const badBind = clone(seed);
badBind.layouts['300x250']!.elements[1].bind = 'nope';
check(
  'unknown slot binding is invalid',
  validateTemplate(badBind).some((issue) => issue.path.endsWith('.bind')),
);
const missingLayout = clone(seed);
delete missingLayout.layouts['728x90'];
check(
  'missing size is invalid',
  validateTemplate(missingLayout).some((issue) => issue.path === 'layouts.728x90'),
);
const badRole = clone(seed);
badRole.layouts['300x250']!.elements[0].style.fill = 'color:secondary';
check('unused color role is invalid', validateTemplate(badRole).length > 0);
const duplicate = clone(seed);
duplicate.layouts['300x250']!.elements[1].id = 'background';
check(
  'duplicate element id is invalid',
  validateTemplate(duplicate).some((issue) => issue.message.includes('duplicate')),
);
const badSample = clone(seed) as Template;
badSample.sample.images.logo = { src: 'https://evil.example/x.png', focalX: 0.5, focalY: 0.5 };
check('sample images must be uploaded assets', validateTemplate(badSample).length > 0);

const unsafe = clone(seed);
const storyHeadline = unsafe.layouts['1080x1920']!.elements.find(
  (element) => element.id === 'headline',
)!;
storyHeadline.frame.y = 1700;
check(
  'text in the 9:16 bottom zone is an error',
  lintTemplate(unsafe, { safeZone: DEFAULT_SAFE_ZONE }).some(
    (issue) => issue.code === 'safe-zone' && issue.elementId === 'headline',
  ),
);
const unplaced = clone(seed);
unplaced.layouts['336x280']!.elements = unplaced.layouts['336x280']!.elements.filter(
  (element) => element.bind !== 'cta',
);
check(
  'required slot missing at one size is an error',
  lintTemplate(unplaced, { safeZone: DEFAULT_SAFE_ZONE }).some(
    (issue) => issue.code === 'missing-slot' && issue.size === '336x280',
  ),
);
const lowContrast = clone(seed);
lowContrast.sample.colors.text = '#2a4a70';
check(
  'low contrast text is a warning',
  lintTemplate(lowContrast, { safeZone: DEFAULT_SAFE_ZONE }).some(
    (issue) => issue.code === 'contrast' && issue.severity === 'warning',
  ),
);
const tooLong = clone(seed);
tooLong.sample.texts.headline = 'x'.repeat(70);
check(
  'sample over maxChars is an error',
  lintTemplate(tooLong, { safeZone: DEFAULT_SAFE_ZONE, measure }).some(
    (issue) => issue.code === 'max-chars',
  ),
);

const adapted = adaptLayout(seed.layouts['300x250']!, '1080x1080');
const background = adapted.elements[0];
check(
  'adapt scales frames to the target size',
  adapted.width === 1080 && background.frame.w === 1080 && background.frame.h === 1080,
  background.frame,
);
check(
  'adapt keeps element ids',
  adapted.elements.map((element) => element.id).join() ===
    seed.layouts['300x250']!.elements.map((element) => element.id).join(),
);
const project = clone(seed.sample);
project.images = { logo: { src: 'assets/c1/0000000000000001.png', focalX: 0.5, focalY: 0.5 } };
check(
  'complete project content has no errors',
  !hasErrors(checkContent(seed, project, { safeZone: DEFAULT_SAFE_ZONE, measure })),
  checkContent(seed, project, { safeZone: DEFAULT_SAFE_ZONE, measure }).filter(
    (issue) => issue.severity === 'error',
  ),
);
const unconfirmed = clone(project);
unconfirmed.texts.offer = '[confirm] 20% off';
check(
  'confirm placeholder blocks export',
  checkContent(seed, unconfirmed, { safeZone: DEFAULT_SAFE_ZONE }).some(
    (issue) => issue.code === 'placeholder',
  ),
);
const empty = clone(project);
empty.texts.headline = ' ';
delete (empty.images as Record<string, unknown>).logo;
const emptyIssues = checkContent(seed, empty, { safeZone: DEFAULT_SAFE_ZONE });
check(
  'empty required text and image block export',
  emptyIssues.some((issue) => issue.message.includes('Headline')) &&
    emptyIssues.some((issue) => issue.message.includes('Logo')),
  emptyIssues,
);
check(
  'project checks skip the long-copy stress test',
  !checkContent(seed, project, { safeZone: DEFAULT_SAFE_ZONE, measure }).some((issue) =>
    issue.message.includes('-character copy'),
  ),
);
finish();
