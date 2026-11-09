export const MAX_SVG_BYTES = 500_000;

export function sanitizeSvg(markup: string): string | undefined {
  if (markup.length > MAX_SVG_BYTES || !/<svg[\s>]/i.test(markup)) {
    return undefined;
  }
  let svg = markup
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!ENTITY[\s\S]*?>/gi, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script[^>]*\/>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/<(iframe|embed|object|audio|video)[\s\S]*?(<\/\1\s*>|\/>)/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/@import[^;]*;/gi, '');
  svg = svg.replace(
    /\s(xlink:href|href)\s*=\s*("([^"]*)"|'([^']*)')/gi,
    (match, _name, _quoted, double, single) => {
      const value = (double ?? single ?? '').trim();
      return value.startsWith('#') || /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(value)
        ? match
        : '';
    },
  );
  svg = svg.replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (match, _quote, value: string) =>
    value.trim().startsWith('#') ? match : 'none',
  );
  if (!/xmlns=/.test(svg)) {
    svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return svg;
}
