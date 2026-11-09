import { useEffect, useState, type FormEvent } from 'react';
import { api, errorText } from '../lib/api';
import type { BrandColors, Settings } from '../lib/types';

const COLOR_LABELS: Array<[keyof BrandColors, string]> = [
  ['primary', 'Primary'],
  ['accent', 'Accent'],
  ['background', 'Background'],
  ['text', 'Text'],
];
const HEX = /^#[0-9a-fA-F]{6}$/;

export function SettingsPage({ onSaved }: { onSaved: () => void }) {
  const [settings, setSettings] = useState<Settings | undefined>();
  const [logo, setLogo] = useState<File | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Settings>('/settings')
      .then(setSettings)
      .catch((reason) => setError(errorText(reason)));
  }, []);

  if (!settings) {
    return error ? <p className="error">{error}</p> : <p className="muted">Loading...</p>;
  }

  const setColor = (key: keyof BrandColors, value: string) =>
    setSettings({ ...settings, colors: { ...settings.colors, [key]: value } });

  const uploadLogo = async (file: File): Promise<string> => {
    const { key, url } = await api<{ key: string; url: string }>('/settings/logo-upload-url', {
      method: 'POST',
      body: { contentType: file.type, size: file.size },
    });
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: file,
    });
    if (!response.ok) {
      throw new Error('Logo upload failed');
    }
    return key;
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const logoKey = logo ? await uploadLogo(logo) : settings.logoKey;
      await api<Settings>('/settings', {
        method: 'PUT',
        body: {
          appName: settings.appName,
          colors: settings.colors,
          logoKey,
          supportEmail: settings.supportEmail || undefined,
          safeZone: settings.safeZone,
          limits: settings.limits,
          requireStaffMfa: settings.requireStaffMfa,
        },
      });
      setSettings(await api<Settings>('/settings'));
      setLogo(undefined);
      setNotice('Saved.');
      onSaved();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <header className="page-header">
        <h1>Settings</h1>
      </header>
      <form className="panel form-grid" onSubmit={save}>
        <h2>Branding</h2>
        <label>
          App name
          <input
            required
            value={settings.appName}
            onChange={(event) => setSettings({ ...settings, appName: event.target.value })}
          />
        </label>
        <label>
          Support email
          <input
            type="email"
            value={settings.supportEmail ?? ''}
            onChange={(event) => setSettings({ ...settings, supportEmail: event.target.value })}
          />
        </label>
        <label>
          Logo (PNG, JPG or WebP, up to 1 MB)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => setLogo(event.target.files?.[0])}
          />
        </label>
        {settings.logoUrl && !logo && (
          <img src={settings.logoUrl} alt="Current logo" className="logo-preview" />
        )}
        <div className="color-grid">
          {COLOR_LABELS.map(([key, label]) => (
            <label key={key}>
              {label}
              <span className="color-input">
                <input
                  type="color"
                  value={HEX.test(settings.colors[key]) ? settings.colors[key] : '#000000'}
                  onChange={(event) => setColor(key, event.target.value)}
                />
                <input
                  value={settings.colors[key]}
                  onChange={(event) => setColor(key, event.target.value)}
                />
              </span>
            </label>
          ))}
        </div>
        <h2>Usage limits per client per day</h2>
        {(
          [
            ['scansPerDay', 'Website scans'],
            ['generationsPerDay', 'AI ad generations'],
            ['imageEditsPerDay', 'AI image edits'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={0}
              max={1000}
              value={settings.limits?.[key] ?? ''}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  limits: {
                    scansPerDay: 10,
                    generationsPerDay: 20,
                    imageEditsPerDay: 20,
                    ...settings.limits,
                    [key]: Number(event.target.value),
                  },
                })
              }
            />
          </label>
        ))}
        <h2>Meta 9:16 safe zone (% of the frame)</h2>
        {(
          [
            ['top', 'Top'],
            ['bottom', 'Bottom'],
            ['sides', 'Each side'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={0}
              max={45}
              value={settings.safeZone?.[key] ?? ''}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  safeZone: {
                    top: 14,
                    bottom: 35,
                    sides: 6,
                    ...settings.safeZone,
                    [key]: Number(event.target.value),
                  },
                })
              }
            />
          </label>
        ))}
        <h2>Security</h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.requireStaffMfa !== false}
            onChange={(event) =>
              setSettings({ ...settings, requireStaffMfa: event.target.checked })
            }
          />
          Staff must use two-step sign-in
        </label>
        <div className="form-actions">
          <button className="button primary" disabled={busy}>
            Save
          </button>
          {notice && <span className="notice">{notice}</span>}
          {error && <span className="error">{error}</span>}
        </div>
      </form>
    </section>
  );
}
