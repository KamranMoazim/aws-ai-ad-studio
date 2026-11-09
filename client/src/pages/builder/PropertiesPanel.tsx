import {
  FONT_NAMES,
  FONTS,
  isFontName,
  LOCKABLE,
  type Element,
  type ElementStyle,
  type Frame,
  type Lockable,
  type Template,
} from '../../../../shared/src/index';
import { ColorField, NumberField, Section, SelectField } from './fields';

interface Props {
  template: Template;
  element: Element;
  onChange: (change: (element: Element) => Element) => void;
}

export function PropertiesPanel({ template, element, onChange }: Props) {
  const isText = element.type === 'text' || element.type === 'button';
  const slotKind = element.type === 'image' ? 'image' : 'text';
  const slots = template.slots.filter((slot) => slot.kind === slotKind);
  const setFrame = (patch: Partial<Frame>) =>
    onChange((current) => ({ ...current, frame: { ...current.frame, ...patch } }));
  const setStyle = (patch: Partial<ElementStyle>) =>
    onChange((current) => ({ ...current, style: { ...current.style, ...patch } }));
  const font = isFontName(element.style.fontFamily ?? '') ? element.style.fontFamily! : 'Inter';
  const fullyLocked = element.locked === true;
  const lockedList: Lockable[] = element.locked === true ? [...LOCKABLE] : element.locked;

  return (
    <div className="builder-panel">
      <Section title={`${element.type} element`}>
        <label className="field">
          Name
          <input
            value={element.name ?? ''}
            placeholder={element.id}
            onChange={(event) =>
              onChange((current) => ({ ...current, name: event.target.value || undefined }))
            }
          />
        </label>
        {element.type !== 'rect' && (
          <SelectField
            label="Bound to slot"
            value={element.bind}
            options={[
              ['', isText ? 'None (fixed text)' : 'None'],
              ...slots.map((slot) => [slot.key, slot.label] as [string, string]),
            ]}
            onChange={(bind) => onChange((current) => ({ ...current, bind }))}
          />
        )}
        {isText && !element.bind && (
          <label className="field">
            Fixed text
            <textarea
              rows={2}
              value={element.text ?? ''}
              onChange={(event) =>
                onChange((current) => ({ ...current, text: event.target.value }))
              }
            />
          </label>
        )}
      </Section>

      <Section title="Position">
        <div className="field-grid">
          <NumberField
            label="X"
            value={element.frame.x}
            onChange={(x) => setFrame({ x: x ?? 0 })}
          />
          <NumberField
            label="Y"
            value={element.frame.y}
            onChange={(y) => setFrame({ y: y ?? 0 })}
          />
          <NumberField
            label="Width"
            min={1}
            value={element.frame.w}
            onChange={(w) => setFrame({ w: Math.max(1, w ?? 1) })}
          />
          <NumberField
            label="Height"
            min={1}
            value={element.frame.h}
            onChange={(h) => setFrame({ h: Math.max(1, h ?? 1) })}
          />
          <NumberField
            label="Rotation"
            value={element.frame.rotation}
            onChange={(rotation) => setFrame({ rotation })}
          />
          <NumberField
            label="Opacity"
            step={0.05}
            min={0}
            max={1}
            value={element.style.opacity}
            onChange={(opacity) => setStyle({ opacity })}
          />
        </div>
      </Section>

      {isText && (
        <Section title="Text">
          <div className="field-grid">
            <SelectField
              label="Font"
              value={font}
              options={FONT_NAMES.map((name) => [name, name])}
              onChange={(fontFamily) => setStyle({ fontFamily })}
            />
            <SelectField
              label="Weight"
              value={String(element.style.fontWeight ?? 400)}
              options={FONTS[font as keyof typeof FONTS].weights.map((weight) => [
                String(weight),
                String(weight),
              ])}
              onChange={(weight) => setStyle({ fontWeight: Number(weight ?? 400) })}
            />
            <NumberField
              label="Size"
              min={4}
              value={element.style.fontSize}
              onChange={(fontSize) => setStyle({ fontSize })}
            />
            <NumberField
              label="Min size"
              min={4}
              value={element.style.minFontSize}
              onChange={(minFontSize) => setStyle({ minFontSize })}
            />
            <NumberField
              label="Line height"
              step={0.05}
              value={element.style.lineHeight}
              onChange={(lineHeight) => setStyle({ lineHeight })}
            />
            <NumberField
              label="Letter spacing"
              step={0.5}
              value={element.style.letterSpacing}
              onChange={(letterSpacing) => setStyle({ letterSpacing })}
            />
            <SelectField
              label="Align"
              value={element.style.align}
              options={[
                ['', 'Default'],
                ['left', 'Left'],
                ['center', 'Center'],
                ['right', 'Right'],
              ]}
              onChange={(align) => setStyle({ align })}
            />
            <SelectField
              label="Vertical"
              value={element.style.verticalAlign}
              options={[
                ['', 'Default'],
                ['top', 'Top'],
                ['middle', 'Middle'],
                ['bottom', 'Bottom'],
              ]}
              onChange={(verticalAlign) => setStyle({ verticalAlign })}
            />
            <SelectField
              label="Fit"
              value={element.fit ?? 'shrink'}
              options={[
                ['shrink', 'Shrink to fit'],
                ['clamp', 'Clamp lines'],
              ]}
              onChange={(fit) => onChange((current) => ({ ...current, fit }))}
            />
            <label className="toggle">
              <input
                type="checkbox"
                checked={Boolean(element.style.uppercase)}
                onChange={(event) => setStyle({ uppercase: event.target.checked || undefined })}
              />
              Uppercase
            </label>
          </div>
          <ColorField
            label="Text color"
            value={element.style.color}
            roles={template.colorRoles}
            onChange={(color) => setStyle({ color })}
          />
        </Section>
      )}

      {(element.type === 'rect' || element.type === 'button') && (
        <Section title="Fill">
          <ColorField
            label="Fill"
            value={element.style.fill}
            roles={template.colorRoles}
            onChange={(fill) => setStyle({ fill })}
          />
          <div className="field-grid">
            <NumberField
              label="Corner radius"
              min={0}
              value={element.style.radius}
              onChange={(radius) => setStyle({ radius })}
            />
            {element.type === 'button' && (
              <NumberField
                label="Padding"
                min={0}
                value={element.style.padding}
                onChange={(padding) => setStyle({ padding })}
              />
            )}
          </div>
        </Section>
      )}

      {element.type === 'image' && (
        <Section title="Image">
          <div className="field-grid">
            <SelectField
              label="Crop"
              value={element.crop ?? 'cover'}
              options={[
                ['cover', 'Cover (focal point)'],
                ['contain', 'Contain'],
              ]}
              onChange={(crop) => onChange((current) => ({ ...current, crop }))}
            />
            <NumberField
              label="Corner radius"
              min={0}
              value={element.style.radius}
              onChange={(radius) => setStyle({ radius })}
            />
          </div>
        </Section>
      )}

      <Section title="Locks">
        <label className="toggle">
          <input
            type="checkbox"
            checked={fullyLocked}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                locked: event.target.checked ? true : ['visible'],
              }))
            }
          />
          Fully locked (clients and AI cannot change it)
        </label>
        {!fullyLocked && (
          <div className="lock-list">
            {LOCKABLE.map((property) => (
              <label key={property} className="toggle">
                <input
                  type="checkbox"
                  checked={lockedList.includes(property)}
                  onChange={(event) =>
                    onChange((current) => ({
                      ...current,
                      locked: event.target.checked
                        ? [...lockedList, property]
                        : lockedList.filter((item) => item !== property),
                    }))
                  }
                />
                {property} fixed
              </label>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
