import { useState } from 'react';
import { COLOR_ROLES } from '../../../../shared/src/index';
import { api, errorText } from '../../lib/api';
import type { Asset, BrandKit } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';
import { ScanPanel } from './ScanPanel';

type Draft = Omit<BrandKit, 'kitId' | 'clientId' | 'updatedAt'>;

const EMPTY: Draft = {
  name: 'Main brand',
  colors: { primary: '#1f3a5f', accent: '#f2a541', text: '#ffffff', background: '#f7f5f0' },
  photoIds: [],
  services: [],
  offers: [],
  ctas: ['Book now'],
};

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

async function loadKits(clientId: string) {
  const [kits, assets] = await Promise.all([
    api<{ brandKits: BrandKit[] }>(`/clients/${clientId}/brand-kits`),
    api<{ assets: Asset[] }>(`/clients/${clientId}/assets`),
  ]);
  return { kits: kits.brandKits, assets: assets.assets };
}

export function BrandKitsTab({ clientId }: { clientId: string }) {
  const { data, error, reload } = useLoad(() => loadKits(clientId), [clientId]);
  const [editing, setEditing] = useState<{ kitId?: string; draft: Draft } | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  if (error) {
    return <p className="error">{error}</p>;
  }
  if (!data) {
    return <p className="muted">Loading...</p>;
  }
  const logos = data.assets.filter((asset) => asset.kind === 'logo');
  const photos = data.assets.filter((asset) => asset.kind === 'photo');

  const save = async () => {
    if (!editing) {
      return;
    }
    setMessage(undefined);
    try {
      const body = {
        ...editing.draft,
        logoLightId: editing.draft.logoLightId || undefined,
        logoDarkId: editing.draft.logoDarkId || undefined,
      };
      await api(`/clients/${clientId}/brand-kits${editing.kitId ? `/${editing.kitId}` : ''}`, {
        method: editing.kitId ? 'PUT' : 'POST',
        body,
      });
      setEditing(undefined);
      await reload();
    } catch (reason) {
      setMessage(errorText(reason));
    }
  };

  if (editing) {
    const draft = editing.draft;
    const set = (patch: Partial<Draft>) =>
      setEditing({ ...editing, draft: { ...draft, ...patch } });
    return (
      <div className="panel form-grid">
        <h2>{editing.kitId ? 'Edit brand kit' : 'New brand kit'}</h2>
        <label>
          Name
          <input value={draft.name} onChange={(event) => set({ name: event.target.value })} />
        </label>
        <div className="color-grid">
          {COLOR_ROLES.map((role) => (
            <label key={role}>
              {role}
              <span className="color-input">
                <input
                  type="color"
                  value={draft.colors[role] ?? '#000000'}
                  onChange={(event) =>
                    set({ colors: { ...draft.colors, [role]: event.target.value } })
                  }
                />
                <input
                  value={draft.colors[role] ?? ''}
                  placeholder="#rrggbb"
                  onChange={(event) => {
                    const colors = { ...draft.colors, [role]: event.target.value };
                    if (!event.target.value) {
                      delete colors[role];
                    }
                    set({ colors });
                  }}
                />
              </span>
            </label>
          ))}
        </div>
        <label>
          Logo for light backgrounds
          <select
            value={draft.logoLightId ?? ''}
            onChange={(event) => set({ logoLightId: event.target.value || undefined })}
          >
            <option value="">None</option>
            {logos.map((asset) => (
              <option key={asset.assetId} value={asset.assetId}>
                {asset.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Logo for dark backgrounds
          <select
            value={draft.logoDarkId ?? ''}
            onChange={(event) => set({ logoDarkId: event.target.value || undefined })}
          >
            <option value="">None</option>
            {logos.map((asset) => (
              <option key={asset.assetId} value={asset.assetId}>
                {asset.name}
              </option>
            ))}
          </select>
        </label>
        <div className="kit-photos">
          <span className="field-label">Approved photos</span>
          {photos.length === 0 && (
            <span className="muted">Upload photos in the Photos and logos tab.</span>
          )}
          <div className="asset-grid small">
            {photos.map((asset) => {
              const chosen = draft.photoIds.includes(asset.assetId);
              return (
                <button
                  key={asset.assetId}
                  className={`asset-choice${chosen ? ' chosen' : ''}`}
                  onClick={() =>
                    set({
                      photoIds: chosen
                        ? draft.photoIds.filter((id) => id !== asset.assetId)
                        : [...draft.photoIds, asset.assetId],
                    })
                  }
                >
                  <img src={asset.url} alt={asset.name} />
                </button>
              );
            })}
          </div>
        </div>
        <label>
          Services (one per line)
          <textarea
            rows={4}
            value={draft.services.map((service) => service.name).join('\n')}
            onChange={(event) =>
              set({ services: lines(event.target.value).map((name) => ({ name })) })
            }
          />
        </label>
        <label>
          Offers (one per line, only real ones)
          <textarea
            rows={4}
            value={draft.offers.map((offer) => offer.text).join('\n')}
            onChange={(event) =>
              set({ offers: lines(event.target.value).map((text) => ({ text })) })
            }
          />
        </label>
        <label>
          Calls to action (one per line)
          <textarea
            rows={4}
            value={draft.ctas.join('\n')}
            onChange={(event) => set({ ctas: lines(event.target.value) })}
          />
        </label>
        <div className="form-actions">
          <button className="button primary" onClick={save}>
            Save brand kit
          </button>
          <button className="button" onClick={() => setEditing(undefined)}>
            Cancel
          </button>
          {message && <span className="error">{message}</span>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <ScanPanel clientId={clientId} onSaved={reload} />
      <button className="button" onClick={() => setEditing({ draft: { ...EMPTY } })}>
        New brand kit by hand
      </button>
      {data.kits.length === 0 && <p className="muted">No brand kits yet.</p>}
      <ul className="kit-list">
        {data.kits.map((kit) => (
          <li key={kit.kitId} className="panel">
            <div className="kit-row">
              <strong>{kit.name}</strong>
              <span className="swatches">
                {Object.entries(kit.colors).map(([role, color]) => (
                  <span
                    key={role}
                    className="swatch"
                    title={`${role} ${color}`}
                    style={{ background: color }}
                  />
                ))}
              </span>
              <span className="muted">
                {kit.photoIds.length} photos, {kit.offers.length} offers, {kit.ctas.length} CTAs
              </span>
              <button
                className="link-button"
                onClick={() => {
                  const { kitId, clientId: _clientId, updatedAt: _updatedAt, ...draft } = kit;
                  setEditing({ kitId, draft });
                }}
              >
                Edit
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
