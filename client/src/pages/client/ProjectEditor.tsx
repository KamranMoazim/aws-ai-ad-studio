import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  checkContent,
  contentForSize,
  hasErrors,
  SIZES,
  sizesForChannel,
  type Content,
  type LintIssue,
  type SafeZone,
  type SizeKey,
  type Template,
} from '../../../../shared/src/index';
import { hashQuery, href } from '../../app/routes';
import { uploadAsset } from '../../lib/assets';
import { api, ApiError, errorText } from '../../lib/api';
import {
  formatMoney,
  type Asset,
  type ExportRecord,
  type Project,
  type ProjectValues,
} from '../../lib/types';
import { AdStage } from '../../renderer/AdStage';
import { ensureFonts } from '../../renderer/fonts';
import { measureText } from '../../renderer/measure';
import { FocalPicker } from './AssetsTab';

interface Loaded {
  project: Project;
  template: Template;
  safeZone: SafeZone;
  imageUrls: Record<string, string>;
  payment: { required: boolean; paid: boolean };
}

const WATERMARK = 'PREVIEW';

const PREVIEW_BOX = 230;
const FOCUS_BOX = { width: 520, height: 520 };
const POLL_MS = 3000;

const fitScale = (size: SizeKey, width: number, height: number) =>
  Math.min(width / SIZES[size].width, height / SIZES[size].height, 1);

const isLogoSlot = (key: string) => key.includes('logo');

export function ProjectEditor({ projectId }: { projectId: string }) {
  const [loaded, setLoaded] = useState<Loaded | undefined>();
  const [values, setValues] = useState<ProjectValues | undefined>();
  const [name, setName] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [focus, setFocus] = useState<SizeKey | undefined>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [exports, setExports] = useState<ExportRecord[]>([]);
  const [openOverrides, setOpenOverrides] = useState<string | undefined>();

  const loadExports = useCallback(
    () =>
      api<{ exports: ExportRecord[] }>(`/projects/${projectId}/exports`)
        .then((result) => setExports(result.exports))
        .catch(() => undefined),
    [projectId],
  );

  useEffect(() => {
    (async () => {
      const [data] = await Promise.all([api<Loaded>(`/projects/${projectId}`), ensureFonts()]);
      const assetList = await api<{ assets: Asset[] }>(`/clients/${data.project.clientId}/assets`);
      setLoaded(data);
      setValues(data.project.values);
      setName(data.project.name);
      setAssets(assetList.assets);
      setFocus(sizesForChannel(data.template.channel)[0]);
      await loadExports();
      if (hashQuery('paid')) {
        setMessage('Payment received. Your files are being prepared and will appear below.');
      }
    })().catch((reason) => setError(errorText(reason)));
  }, [projectId, loadExports]);

  useEffect(() => {
    if (!exports.some((record) => record.status === 'rendering')) {
      return;
    }
    const timer = setInterval(loadExports, POLL_MS);
    return () => clearInterval(timer);
  }, [exports, loadExports]);

  const urls = useMemo(() => {
    const map: Record<string, string> = { ...(loaded?.imageUrls ?? {}) };
    for (const asset of assets) {
      if (asset.key && asset.url) {
        map[asset.key] = asset.url;
      }
    }
    return map;
  }, [loaded, assets]);

  const issues = useMemo<LintIssue[]>(
    () =>
      loaded && values
        ? checkContent(loaded.template, values as Content, {
            safeZone: loaded.safeZone,
            measure: measureText,
          })
        : [],
    [loaded, values],
  );

  if (error && !loaded) {
    return <p className="error">{error}</p>;
  }
  if (!loaded || !values || !focus) {
    return <p className="muted">Loading editor...</p>;
  }
  const { template, project } = loaded;
  const sizes = sizesForChannel(template.channel);
  const content = values as Content;
  const errorsBySize = (size: SizeKey) =>
    issues.filter((issue) => issue.size === size && issue.severity === 'error').length;

  const change = (next: ProjectValues) => {
    setValues(next);
    setDirty(true);
  };
  const setText = (key: string, text: string) =>
    change({ ...values, texts: { ...values.texts, [key]: text } });
  const setOverride = (size: SizeKey, key: string, text: string) => {
    const forSize = { ...(values.textOverrides?.[size] ?? {}) };
    if (text) {
      forSize[key] = text;
    } else {
      delete forSize[key];
    }
    change({ ...values, textOverrides: { ...(values.textOverrides ?? {}), [size]: forSize } });
  };
  const setImage = (key: string, asset: Asset | undefined) => {
    const images = { ...values.images };
    if (asset?.key) {
      images[key] = { src: asset.key, focalX: asset.focalX, focalY: asset.focalY };
    } else {
      delete images[key];
    }
    change({ ...values, images });
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await action();
    } catch (reason) {
      setError(
        reason instanceof ApiError && reason.code === 'conflict'
          ? 'Someone else saved this ad set. Reload the page to see their changes.'
          : errorText(reason),
      );
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      const saved = await api<Project>(`/projects/${projectId}`, {
        method: 'PUT',
        body: { revision: project.revision, name, values },
      });
      setLoaded({ ...loaded, project: saved });
      setDirty(false);
      setMessage('Saved.');
    });

  const exportNow = () =>
    run(async () => {
      const result = await api<{ exportId: string; checkoutUrl?: string }>(
        `/projects/${projectId}/export`,
        { method: 'POST' },
      );
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      setMessage('Export started. Files appear below when ready.');
      await loadExports();
    });

  const emailLink = (record: ExportRecord) =>
    run(async () => {
      const result = await api<{ sentTo: string }>(
        `/projects/${projectId}/exports/${record.exportId}/email`,
        { method: 'POST' },
      );
      setMessage(`Download link sent to ${result.sentTo}. It works for 7 days.`);
    });

  const download = (record: ExportRecord) =>
    run(async () => {
      const result = await api<{ downloadUrl?: string }>(
        `/projects/${projectId}/exports/${record.exportId}`,
      );
      if (result.downloadUrl) {
        window.location.href = result.downloadUrl;
      }
    });

  const upload = (slotKey: string, file: File | undefined) =>
    file &&
    run(async () => {
      const asset = await uploadAsset(
        project.clientId,
        file,
        isLogoSlot(slotKey) ? 'logo' : 'photo',
      );
      setAssets([asset, ...assets]);
      setImage(slotKey, asset);
    });

  const blocking = hasErrors(issues);
  const watermark = loaded.payment.required && !loaded.payment.paid ? WATERMARK : undefined;
  const rendering = exports.some((record) => record.status === 'rendering');

  return (
    <section className="editor">
      <header className="builder-bar">
        <a href={href.client(project.clientId)} className="muted">
          Ad sets
        </a>
        <input
          className="builder-name"
          aria-label="Ad set name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setDirty(true);
          }}
        />
        <span className="muted">
          {template.name} v{template.version}
        </span>
        <span className="builder-actions">
          <button className="button" disabled={busy || !dirty} onClick={save}>
            Save
          </button>
          <button
            className="button primary"
            disabled={busy || dirty || blocking || rendering}
            title={dirty ? 'Save first' : blocking ? 'Fix the problems marked in red' : undefined}
            onClick={exportNow}
          >
            {rendering
              ? 'Exporting...'
              : loaded.payment.required
                ? `Pay and export ${sizes.length} sizes`
                : `Export ${sizes.length} sizes`}
          </button>
        </span>
      </header>
      {(message || error) && <p className={error ? 'error' : 'notice'}>{error ?? message}</p>}

      <div className="editor-body">
        <aside className="editor-fields">
          {template.slots.map((slot) =>
            slot.kind === 'text' ? (
              <div key={slot.key} className="builder-section">
                <h3>{slot.label}</h3>
                <textarea
                  rows={slot.limits?.maxLines && slot.limits.maxLines > 1 ? 2 : 1}
                  value={values.texts[slot.key] ?? ''}
                  onChange={(event) => setText(slot.key, event.target.value)}
                />
                <div className="char-limits">
                  {sizes.map((size) => {
                    const limit = slot.limits?.maxChars[size];
                    const text = contentForSize(content, size).texts[slot.key] ?? '';
                    if (!limit) {
                      return null;
                    }
                    return (
                      <span key={size} className={text.length > limit ? 'over' : undefined}>
                        {size}: {text.length}/{limit}
                      </span>
                    );
                  })}
                </div>
                <button
                  className="link-button"
                  onClick={() =>
                    setOpenOverrides(openOverrides === slot.key ? undefined : slot.key)
                  }
                >
                  {openOverrides === slot.key ? 'Hide' : 'Shorter text for some sizes'}
                </button>
                {openOverrides === slot.key &&
                  sizes.map((size) => (
                    <label key={size} className="field">
                      {size}
                      <input
                        placeholder="Uses the text above"
                        value={values.textOverrides?.[size]?.[slot.key] ?? ''}
                        onChange={(event) => setOverride(size, slot.key, event.target.value)}
                      />
                    </label>
                  ))}
              </div>
            ) : (
              <div key={slot.key} className="builder-section">
                <h3>{slot.label}</h3>
                <select
                  value={
                    assets.find((asset) => asset.key === values.images[slot.key]?.src)?.assetId ??
                    ''
                  }
                  onChange={(event) =>
                    setImage(
                      slot.key,
                      assets.find((asset) => asset.assetId === event.target.value),
                    )
                  }
                >
                  <option value="">None</option>
                  {assets
                    .filter((asset) => asset.kind === (isLogoSlot(slot.key) ? 'logo' : 'photo'))
                    .map((asset) => (
                      <option key={asset.assetId} value={asset.assetId}>
                        {asset.name}
                      </option>
                    ))}
                </select>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label={`Upload ${slot.label}`}
                  onChange={(event) => upload(slot.key, event.target.files?.[0])}
                />
                {values.images[slot.key] &&
                  !isLogoSlot(slot.key) &&
                  urls[values.images[slot.key].src] && (
                    <FocalPicker
                      asset={{
                        ...(assets.find(
                          (asset) => asset.key === values.images[slot.key].src,
                        ) as Asset),
                        url: urls[values.images[slot.key].src],
                        focalX: values.images[slot.key].focalX,
                        focalY: values.images[slot.key].focalY,
                      }}
                      onPick={(focalX, focalY) =>
                        change({
                          ...values,
                          images: {
                            ...values.images,
                            [slot.key]: { ...values.images[slot.key], focalX, focalY },
                          },
                        })
                      }
                    />
                  )}
              </div>
            ),
          )}
          <div className="builder-section">
            <h3>Colors</h3>
            <div className="color-grid">
              {template.colorRoles.map((role) => (
                <label key={role} className="field">
                  {role}
                  <span className="color-input">
                    <input
                      type="color"
                      value={values.colors[role] ?? '#000000'}
                      onChange={(event) =>
                        change({
                          ...values,
                          colors: { ...values.colors, [role]: event.target.value },
                        })
                      }
                    />
                    <input
                      value={values.colors[role] ?? ''}
                      onChange={(event) => {
                        if (/^#[0-9a-fA-F]{6}$/.test(event.target.value)) {
                          change({
                            ...values,
                            colors: { ...values.colors, [role]: event.target.value },
                          });
                        }
                      }}
                    />
                  </span>
                </label>
              ))}
            </div>
          </div>
        </aside>

        <div className="editor-previews">
          <div className="canvas-frame focus-frame">
            <AdStage
              template={template}
              size={focus}
              content={contentForSize(content, focus)}
              scale={fitScale(focus, FOCUS_BOX.width, FOCUS_BOX.height)}
              imageUrl={(src) => urls[src]}
              safeZone={loaded.safeZone}
              watermark={watermark}
            />
          </div>
          <div className="preview-grid">
            {sizes.map((size) => {
              const count = errorsBySize(size);
              return (
                <button
                  key={size}
                  className={`preview-card${size === focus ? ' active' : ''}`}
                  onClick={() => setFocus(size)}
                >
                  <span className="preview-canvas">
                    <AdStage
                      template={template}
                      size={size}
                      content={contentForSize(content, size)}
                      scale={fitScale(size, PREVIEW_BOX, PREVIEW_BOX * 0.7)}
                      imageUrl={(src) => urls[src]}
                      watermark={watermark}
                    />
                  </span>
                  <span className="size-thumb-label">
                    {size}
                    {count ? (
                      <span className="badge disabled">{count}</span>
                    ) : (
                      <span className="badge active">ok</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {issues.length > 0 && (
            <div className="lint-list">
              <h3>Check before export</h3>
              <ul>
                {issues.map((issue, index) => (
                  <li key={index} className={issue.severity}>
                    <button
                      className="link-button"
                      onClick={() => issue.size && setFocus(issue.size)}
                    >
                      {issue.size}
                    </button>{' '}
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="panel">
            <h2>Exports</h2>
            {exports.length === 0 && <p className="muted">No exports yet.</p>}
            <ul className="plain-list">
              {exports.map((record) => (
                <li key={record.exportId} className="export-row">
                  <span>{new Date(record.createdAt).toLocaleString()}</span>
                  <span
                    className={`badge ${record.status === 'ready' ? 'active' : record.status === 'failed' ? 'disabled' : ''}`}
                  >
                    {record.status}
                  </span>
                  {record.status === 'awaiting_payment' && record.checkoutUrl && (
                    <>
                      <span className="muted">
                        {record.amountCents && record.currency
                          ? formatMoney(record.amountCents, record.currency)
                          : ''}
                      </span>
                      <a className="link-button" href={record.checkoutUrl}>
                        Pay now
                      </a>
                    </>
                  )}
                  {record.status === 'ready' && record.revoked && (
                    <span className="muted">Refunded; downloads are disabled</span>
                  )}
                  {record.status === 'ready' && !record.revoked && (
                    <>
                      <span className="muted">
                        {record.files?.length} files,{' '}
                        {record.files
                          ?.filter((file) => SIZES[file.size as SizeKey]?.channel === 'display')
                          .map((file) => `${file.size} ${Math.round(file.bytes / 1024)} KB`)
                          .join(', ')}
                      </span>
                      <button className="link-button" onClick={() => download(record)}>
                        Download ZIP
                      </button>
                      <button className="link-button" onClick={() => emailLink(record)}>
                        Email me the link
                      </button>
                    </>
                  )}
                  {record.status === 'failed' && <span className="error">{record.error}</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
