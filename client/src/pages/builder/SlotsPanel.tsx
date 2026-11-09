import { useState } from 'react';
import {
  COLOR_ROLES,
  SIZES,
  sizesForChannel,
  type ColorRole,
  type Slot,
  type Template,
} from '../../../../shared/src/index';
import { NumberField, Section } from './fields';

interface Props {
  template: Template;
  onChange: (template: Template) => void;
}

const SLOT_KEY = /^[a-z][a-z0-9-]{0,31}$/;

export function SlotsPanel({ template, onChange }: Props) {
  const [newKey, setNewKey] = useState('');
  const [newKind, setNewKind] = useState<'text' | 'image'>('text');
  const sizes = sizesForChannel(template.channel);

  const setSlot = (key: string, change: (slot: Slot) => Slot) =>
    onChange({
      ...template,
      slots: template.slots.map((slot) => (slot.key === key ? change(slot) : slot)),
    });

  const removeSlot = (key: string) => {
    const layouts = Object.fromEntries(
      Object.entries(template.layouts).map(([size, layout]) => [
        size,
        {
          ...layout!,
          elements: layout!.elements.map((element) =>
            element.bind === key ? { ...element, bind: undefined } : element,
          ),
        },
      ]),
    );
    const texts = { ...template.sample.texts };
    const images = { ...template.sample.images };
    delete texts[key];
    delete images[key];
    onChange({
      ...template,
      slots: template.slots.filter((slot) => slot.key !== key),
      layouts,
      sample: { ...template.sample, texts, images },
    });
  };

  const addSlot = () => {
    if (!SLOT_KEY.test(newKey) || template.slots.some((slot) => slot.key === newKey)) {
      return;
    }
    const slot: Slot =
      newKind === 'text'
        ? {
            key: newKey,
            label: newKey,
            kind: 'text',
            required: false,
            limits: { maxChars: {}, maxLines: 2 },
          }
        : { key: newKey, label: newKey, kind: 'image', required: false };
    onChange({ ...template, slots: [...template.slots, slot] });
    setNewKey('');
  };

  const toggleRole = (role: ColorRole, on: boolean) =>
    onChange({
      ...template,
      colorRoles: on
        ? COLOR_ROLES.filter((item) => item === role || template.colorRoles.includes(item))
        : template.colorRoles.filter((item) => item !== role),
    });

  return (
    <div className="builder-panel">
      <Section title="Color roles">
        <div className="lock-list">
          {COLOR_ROLES.map((role) => (
            <label key={role} className="toggle">
              <input
                type="checkbox"
                checked={template.colorRoles.includes(role)}
                onChange={(event) => toggleRole(role, event.target.checked)}
              />
              {role}
            </label>
          ))}
        </div>
      </Section>
      {template.slots.map((slot) => (
        <Section key={slot.key} title={`${slot.kind} slot: ${slot.key}`}>
          <label className="field">
            Label
            <input
              value={slot.label}
              onChange={(event) =>
                setSlot(slot.key, (current) => ({ ...current, label: event.target.value }))
              }
            />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={slot.required}
              onChange={(event) =>
                setSlot(slot.key, (current) => ({ ...current, required: event.target.checked }))
              }
            />
            Required at every size
          </label>
          {slot.kind === 'text' && (
            <>
              <NumberField
                label="Max lines"
                min={1}
                value={slot.limits?.maxLines}
                onChange={(maxLines) =>
                  setSlot(slot.key, (current) => ({
                    ...current,
                    limits: {
                      maxChars: current.limits?.maxChars ?? {},
                      maxLines: Math.max(1, maxLines ?? 1),
                    },
                  }))
                }
              />
              <div className="field-grid">
                {sizes.map((size) => (
                  <NumberField
                    key={size}
                    label={`Max chars ${SIZES[size].width}x${SIZES[size].height}`}
                    min={1}
                    value={slot.limits?.maxChars[size]}
                    onChange={(count) =>
                      setSlot(slot.key, (current) => {
                        const maxChars = { ...(current.limits?.maxChars ?? {}) };
                        if (count) {
                          maxChars[size] = count;
                        } else {
                          delete maxChars[size];
                        }
                        return {
                          ...current,
                          limits: { maxLines: current.limits?.maxLines ?? 2, maxChars },
                        };
                      })
                    }
                  />
                ))}
              </div>
            </>
          )}
          <button className="link-button" onClick={() => removeSlot(slot.key)}>
            Remove slot
          </button>
        </Section>
      ))}
      <Section title="Add a slot">
        <div className="add-row">
          <input
            placeholder="key, e.g. disclaimer"
            value={newKey}
            onChange={(event) => setNewKey(event.target.value.toLowerCase())}
          />
          <select
            value={newKind}
            onChange={(event) => setNewKind(event.target.value as 'text' | 'image')}
          >
            <option value="text">Text</option>
            <option value="image">Image</option>
          </select>
          <button className="button small" disabled={!SLOT_KEY.test(newKey)} onClick={addSlot}>
            Add
          </button>
        </div>
      </Section>
    </div>
  );
}
