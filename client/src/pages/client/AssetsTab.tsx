import { useState, type MouseEvent } from 'react';
import { uploadAsset } from '../../lib/assets';
import { api, errorText } from '../../lib/api';
import type { Asset, BrandKit } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';

export function FocalPicker({
  asset,
  onPick,
}: {
  asset: Asset;
  onPick: (focalX: number, focalY: number) => void;
}) {
  const pick = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const round = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
    onPick(
      round((event.clientX - box.left) / box.width),
      round((event.clientY - box.top) / box.height),
    );
  };
  return (
    <div className="focal-picker" onClick={pick} title="Click the most important part of the photo">
      <img src={asset.url} alt={asset.name} />
      <span
        className="focal-dot"
        style={{ left: `${asset.focalX * 100}%`, top: `${asset.focalY * 100}%` }}
      />
    </div>
  );
}

export function AssetsTab({ clientId }: { clientId: string }) {
  const { data, error, reload } = useLoad(
    () => api<{ assets: Asset[] }>(`/clients/${clientId}/assets`),
    [clientId],
  );
  const [kind, setKind] = useState<Asset['kind']>('photo');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();

  const upload = async (files: FileList | null) => {
    if (!files?.length) {
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      for (const file of Array.from(files)) {
        await uploadAsset(clientId, file, kind);
      }
      await reload();
    } catch (reason) {
      setMessage(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const edit = async (asset: Asset, op: 'remove-bg' | 'outpaint', aspect?: string) => {
    setBusy(true);
    setMessage(undefined);
    try {
      await api(`/clients/${clientId}/images/${asset.assetId}/${op}`, {
        method: 'POST',
        body: op === 'outpaint' ? { aspect } : {},
      });
      await reload();
    } catch (reason) {
      setMessage(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const setFocal = async (asset: Asset, focalX: number, focalY: number) => {
    await api(`/clients/${clientId}/assets/${asset.assetId}`, {
      method: 'PUT',
      body: { focalX, focalY },
    });
    await reload();
  };

  return (
    <div>
      <div className="panel">
        <h2>Upload</h2>
        <div className="inline-form">
          <select value={kind} onChange={(event) => setKind(event.target.value as Asset['kind'])}>
            <option value="photo">Photos</option>
            <option value="logo">Logos</option>
          </select>
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(event) => upload(event.target.files)}
          />
          {busy && <span className="muted">Uploading and processing...</span>}
        </div>
        <p className="hint">
          PNG, JPEG or WebP up to 10 MB. Photos are resized, cleaned of metadata and get an
          automatic focal point.
        </p>
        {message && <p className="error">{message}</p>}
      </div>
      <BackgroundForm
        clientId={clientId}
        busy={busy}
        setBusy={setBusy}
        onDone={reload}
        onError={setMessage}
      />
      {error && <p className="error">{error}</p>}
      {data && data.assets.length === 0 && <p className="muted">No photos or logos yet.</p>}
      <div className="asset-grid">
        {(data?.assets ?? []).map((asset) => (
          <figure key={asset.assetId} className="asset-card">
            {asset.kind === 'photo' ? (
              <FocalPicker asset={asset} onPick={(x, y) => setFocal(asset, x, y)} />
            ) : (
              <div className="logo-box">
                <img src={asset.url} alt={asset.name} />
              </div>
            )}
            <figcaption>
              <span>
                {asset.name}{' '}
                {asset.source?.startsWith('ai-') && (
                  <span className="badge">
                    {asset.source === 'ai-generated' ? 'AI generated' : 'AI edited'}
                  </span>
                )}
              </span>
              <span className="muted">
                {asset.kind} - {asset.width} x {asset.height}
                {asset.facesFound
                  ? ` - ${asset.facesFound} face${asset.facesFound > 1 ? 's' : ''}`
                  : ''}
              </span>
              <span className="asset-actions">
                <button
                  className="link-button"
                  disabled={busy}
                  onClick={() => edit(asset, 'remove-bg')}
                >
                  Remove background
                </button>
                {asset.kind === 'photo' &&
                  ['9:16', '4:5', '1:1'].map((aspect) => (
                    <button
                      key={aspect}
                      className="link-button"
                      disabled={busy}
                      onClick={() => edit(asset, 'outpaint', aspect)}
                    >
                      Extend to {aspect}
                    </button>
                  ))}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function BackgroundForm({
  clientId,
  busy,
  setBusy,
  onDone,
  onError,
}: {
  clientId: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onDone: () => void;
  onError: (message: string | undefined) => void;
}) {
  const kits = useLoad(
    () => api<{ brandKits: BrandKit[] }>(`/clients/${clientId}/brand-kits`),
    [clientId],
  );
  const [kitId, setKitId] = useState('');
  const [style, setStyle] = useState('Soft abstract waves');
  const [aspect, setAspect] = useState('1:1');
  const chosen = kitId || kits.data?.brandKits[0]?.kitId || '';
  if (!kits.data?.brandKits.length) {
    return null;
  }
  const generate = async () => {
    setBusy(true);
    onError(undefined);
    try {
      await api(`/clients/${clientId}/images/background`, {
        method: 'POST',
        body: { brandKitId: chosen, style, aspect },
      });
      onDone();
    } catch (reason) {
      onError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel">
      <h2>Generate a background</h2>
      <p className="hint">
        An abstract background in the brand colours, for templates with a photo slot when the
        website has no usable photos. Never people, products, text or logos.
      </p>
      <div className="inline-form">
        <select
          aria-label="Brand kit"
          value={chosen}
          onChange={(event) => setKitId(event.target.value)}
        >
          {kits.data.brandKits.map((kit) => (
            <option key={kit.kitId} value={kit.kitId}>
              {kit.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Style"
          value={style}
          onChange={(event) => setStyle(event.target.value)}
        />
        <select
          aria-label="Shape"
          value={aspect}
          onChange={(event) => setAspect(event.target.value)}
        >
          {['1:1', '4:5', '9:16', '16:9'].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <button className="button" disabled={busy || style.trim().length < 3} onClick={generate}>
          Generate
        </button>
      </div>
    </div>
  );
}
