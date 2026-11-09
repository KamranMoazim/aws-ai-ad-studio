import {
  adaptLayout,
  sizesForChannel,
  type Element,
  type ElementType,
  type Layout,
  type SizeKey,
  type Template,
} from '../../../../shared/src/index';

export const clone = <T>(value: T): T => structuredClone(value);

export const newElementId = () => `el-${Math.random().toString(36).slice(2, 10)}`;

export function updateElement(
  template: Template,
  size: SizeKey,
  elementId: string,
  change: (element: Element) => Element,
): Template {
  const next = clone(template);
  const layout = next.layouts[size]!;
  layout.elements = layout.elements.map((element) =>
    element.id === elementId ? change(element) : element,
  );
  return next;
}

export function updateLayout(
  template: Template,
  size: SizeKey,
  change: (layout: Layout) => Layout,
): Template {
  const next = clone(template);
  next.layouts[size] = change(next.layouts[size]!);
  return next;
}

export function newElement(type: ElementType, layout: Layout): Element {
  const unit = Math.min(layout.width, layout.height);
  const w = type === 'text' ? layout.width * 0.6 : unit * 0.4;
  const h = type === 'button' ? unit * 0.16 : type === 'text' ? unit * 0.2 : unit * 0.4;
  const fontSize = Math.max(8, Math.round(type === 'button' ? h * 0.42 : unit * 0.08));
  const base: Element = {
    id: newElementId(),
    type,
    frame: {
      x: Math.round((layout.width - w) / 2),
      y: Math.round((layout.height - h) / 2),
      w: Math.round(w),
      h: Math.round(h),
    },
    style: {},
    locked: ['visible'],
  };
  if (type === 'text') {
    return {
      ...base,
      text: 'Text',
      fit: 'shrink',
      style: {
        fontFamily: 'Inter',
        fontWeight: 700,
        fontSize,
        minFontSize: Math.max(8, Math.round(fontSize * 0.6)),
        color: 'color:primary',
      },
    };
  }
  if (type === 'button') {
    return {
      ...base,
      text: 'Button',
      fit: 'shrink',
      style: {
        fontFamily: 'Inter',
        fontWeight: 700,
        fontSize,
        minFontSize: Math.max(8, Math.round(fontSize * 0.6)),
        fill: 'color:accent',
        color: 'color:primary',
        radius: Math.round(h * 0.2),
        padding: Math.round(h * 0.12),
        align: 'center',
        verticalAlign: 'middle',
      },
    };
  }
  if (type === 'image') {
    return { ...base, crop: 'cover' };
  }
  return { ...base, style: { fill: 'color:primary' } };
}

export function adaptToAllSizes(template: Template, source: SizeKey): Template {
  const next = clone(template);
  for (const size of sizesForChannel(template.channel)) {
    if (size !== source) {
      next.layouts[size] = adaptLayout(template.layouts[source]!, size);
    }
  }
  return next;
}
