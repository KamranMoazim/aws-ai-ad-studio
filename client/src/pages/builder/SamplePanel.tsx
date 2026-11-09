import { useState } from 'react';
import type { SizeKey, Template } from '../../../../shared/src/index';
import { api, errorText } from '../../lib/api';
import { NumberField, Section } from './fields';

interface Props {
  template: Template;
  size: SizeKey;
  onChange: (template: Template) => void;
}

async function uploadSample(templateId: string, file: File): Promise<string> {
  const { key, url } = await api<{ key: string; url: string }>(
    `/templates/${templateId}/asset-upload-url`,
    { method: 'POST', body: { contentType: file.type, size: file.size } },
  );
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': file.type },
    body: file,
  });
  if (!response.ok) {
    throw new Error('Upload failed');
  }
  return key;
}

export function SamplePanel({ template, size, onChange }: Props) {
  const [error, setError] = useState<string | undefined>();
  const sample = template.sample;
  const overrides = sample.textOverrides?.[size] ?? {};

  const setText = (key: string, value: string) =>
    onChange({ ...template, sample: { ...sample, texts: { ...sample.texts, [key]: value } } });

  const setOverride = (key: string, value: string) => {
    const forSize = { ...overrides };
    if (value) {
      forSize[key] = value;
    } else {
      delete forSize[key];
    }
    onChange({
      ...template,
      sample: { ...sample, textOverrides: { ...(sample.textOverrides ?? {}), [size]: forSize } },
    });
  };

  const setImage = (
    key: string,
    patch: Partial<{ src: string; focalX: number; focalY: number }>,
  ) => {
    const current = sample.images[key] ?? { src: '', focalX: 0.5, focalY: 0.5 };
    onChange({
      ...template,
      sample: { ...sample, images: { ...sample.images, [key]: { ...current, ...patch } } },
    });
  };

  const removeImage = (key: string) => {
    const images = { ...sample.images };
    delete images[key];
    onChange({ ...template, sample: { ...sample, images } });
  };

  return (
    <div className="builder-panel">
      {error && <p className="error">{error}</p>}
      <Section title="Sample colors">
        <div className="field-grid">
          {template.colorRoles.map((role) => (
            <label key={role} className="field">
              {role}
              <input
                type="color"
                value={sample.colors[role] ?? '#000000'}
                onChange={(event) =>
                  onChange({
                    ...template,
                    sample: { ...sample, colors: { ...sample.colors, [role]: event.target.value } },
                  })
                }
              />
            </label>
          ))}
        </div>
      </Section>
      {template.slots.map((slot) =>
        slot.kind === 'text' ? (
          <Section key={slot.key} title={slot.label}>
            <label className="field">
              Sample text
              <textarea
                rows={2}
                value={sample.texts[slot.key] ?? ''}
                onChange={(event) => setText(slot.key, event.target.value)}
              />
            </label>
            <label className="field">
              Override for {size}
              <input
                placeholder="Uses the sample text"
                value={overrides[slot.key] ?? ''}
                onChange={(event) => setOverride(slot.key, event.target.value)}
              />
            </label>
          </Section>
        ) : (
          <Section key={slot.key} title={slot.label}>
            <label className="field">
              Sample image (PNG, JPG or WebP, up to 5 MB)
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) {
                    return;
                  }
                  setError(undefined);
                  try {
                    setImage(slot.key, { src: await uploadSample(template.id, file) });
                  } catch (reason) {
                    setError(errorText(reason));
                  }
                }}
              />
            </label>
            {sample.images[slot.key] && (
              <>
                <div className="field-grid">
                  <NumberField
                    label="Focal X (0-1)"
                    step={0.05}
                    min={0}
                    max={1}
                    value={sample.images[slot.key].focalX}
                    onChange={(focalX) => setImage(slot.key, { focalX: focalX ?? 0.5 })}
                  />
                  <NumberField
                    label="Focal Y (0-1)"
                    step={0.05}
                    min={0}
                    max={1}
                    value={sample.images[slot.key].focalY}
                    onChange={(focalY) => setImage(slot.key, { focalY: focalY ?? 0.5 })}
                  />
                </div>
                <button className="link-button" onClick={() => removeImage(slot.key)}>
                  Remove sample image
                </button>
              </>
            )}
          </Section>
        ),
      )}
    </div>
  );
}
