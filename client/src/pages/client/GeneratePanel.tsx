import { useEffect, useMemo, useState } from 'react';
import {
  contentForSize,
  SIZES,
  sizesForChannel,
  type Content,
  type Template,
} from '../../../../shared/src/index';
import { href } from '../../app/routes';
import { api, errorText } from '../../lib/api';
import type { Asset, BrandKit, Project } from '../../lib/types';
import { AdStage } from '../../renderer/AdStage';
import { ensureFonts } from '../../renderer/fonts';

interface Variant {
  templateId: string;
  templateVersion: number;
  templateName: string;
  values: Content;
  confirmed: string[];
}

interface Generation {
  generationId: string;
  status: 'queued' | 'writing' | 'checking' | 'ready' | 'failed';
  variants?: Variant[];
  error?: string;
}

const POLL_MS = 3000;
const PREVIEW_BOX = 220;
const PROGRESS: Record<string, string> = {
  queued: 'Choosing templates...',
  writing: 'Writing copy for every size and checking it fits...',
  checking: 'Checking the ads...',
};

function VariantPreview({
  template,
  values,
  urls,
}: {
  template: Template;
  values: Content;
  urls: Record<string, string>;
}) {
  const sizes = sizesForChannel(template.channel);
  const size = sizes.includes('1080x1080') ? '1080x1080' : sizes[0];
  const scale = Math.min(PREVIEW_BOX / SIZES[size].width, PREVIEW_BOX / SIZES[size].height);
  return (
    <AdStage
      template={template}
      size={size}
      content={contentForSize(values, size)}
      scale={scale}
      imageUrl={(src) => urls[src]}
    />
  );
}

export function GeneratePanel({ clientId, onCancel }: { clientId: string; onCancel: () => void }) {
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [kitId, setKitId] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [offerText, setOfferText] = useState('');
  const [channel, setChannel] = useState<'both' | 'display' | 'meta'>('both');
  const [notes, setNotes] = useState('');
  const [quality, setQuality] = useState<'final' | 'draft'>('final');
  const [generation, setGeneration] = useState<Generation | undefined>();
  const [templates, setTemplates] = useState<Record<string, Template>>({});
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    Promise.all([
      api<{ brandKits: BrandKit[] }>(`/clients/${clientId}/brand-kits`),
      api<{ assets: Asset[] }>(`/clients/${clientId}/assets`),
      ensureFonts(),
    ])
      .then(([kitList, assets]) => {
        setKits(kitList.brandKits);
        setKitId(kitList.brandKits[0]?.kitId ?? '');
        setUrls(
          Object.fromEntries(
            assets.assets
              .filter((asset) => asset.key && asset.url)
              .map((asset) => [asset.key!, asset.url!]),
          ),
        );
      })
      .catch((reason) => setError(errorText(reason)));
  }, [clientId]);

  useEffect(() => {
    if (!generation || generation.status === 'ready' || generation.status === 'failed') {
      return;
    }
    const timer = setInterval(async () => {
      try {
        const latest = await api<Generation>(
          `/clients/${clientId}/generations/${generation.generationId}`,
        );
        if (latest.status === 'ready') {
          const bodies = await Promise.all(
            (latest.variants ?? []).map((variant) =>
              api<{ template: Template }>(
                `/clients/${clientId}/templates/${variant.templateId}`,
              ).then((result) => result.template),
            ),
          );
          setTemplates(Object.fromEntries(bodies.map((template) => [template.id, template])));
        }
        setGeneration(latest);
      } catch (reason) {
        setError(errorText(reason));
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [clientId, generation]);

  const kit = useMemo(() => kits.find((item) => item.kitId === kitId), [kits, kitId]);

  const start = async () => {
    setError(undefined);
    try {
      setGeneration(
        await api<Generation>(`/clients/${clientId}/generations`, {
          method: 'POST',
          body: {
            brandKitId: kitId,
            channel,
            quality,
            serviceName: serviceName || undefined,
            offerText: offerText || undefined,
            notes: notes.trim() || undefined,
          },
        }),
      );
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  const open = async (index: number, variant: Variant) => {
    try {
      const project = await api<Project>(
        `/clients/${clientId}/generations/${generation!.generationId}/variants/${index}/project`,
        {
          method: 'POST',
          body: { name: `${kit?.name ?? 'Ads'}: ${variant.templateName}`.slice(0, 120) },
        },
      );
      window.location.hash = href.project(project.projectId);
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  const running = generation && generation.status !== 'ready' && generation.status !== 'failed';
  return (
    <div className="panel">
      <h2>Make ads with AI</h2>
      {error && <p className="error">{error}</p>}
      {!generation && (
        <>
          {kits.length === 0 && (
            <p className="muted">Create a brand kit first, from the website or by hand.</p>
          )}
          <div className="form-grid wide-fields">
            <label>
              Brand kit
              <select value={kitId} onChange={(event) => setKitId(event.target.value)}>
                {kits.map((item) => (
                  <option key={item.kitId} value={item.kitId}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Focus
              <select value={serviceName} onChange={(event) => setServiceName(event.target.value)}>
                <option value="">The whole business</option>
                {(kit?.services ?? []).map((service) => (
                  <option key={service.name} value={service.name}>
                    {service.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Offer
              <select value={offerText} onChange={(event) => setOfferText(event.target.value)}>
                <option value="">No offer</option>
                {(kit?.offers ?? []).map((offer) => (
                  <option key={offer.text} value={offer.text}>
                    {offer.text}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Channel
              <select
                value={channel}
                onChange={(event) => setChannel(event.target.value as typeof channel)}
              >
                <option value="both">Display and Meta</option>
                <option value="display">Display</option>
                <option value="meta">Meta</option>
              </select>
            </label>
            <label>
              Quality
              <select
                value={quality}
                onChange={(event) => setQuality(event.target.value as typeof quality)}
              >
                <option value="final">Best copy</option>
                <option value="draft">Quick draft</option>
              </select>
            </label>
            <label className="span-all">
              Notes (optional)
              <input
                placeholder="e.g. spring sale, friendly and urgent"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
          </div>
          <p className="hint">
            Only facts from the brand kit are used. Anything the AI cannot back up is left as
            [confirm] for you to fill in.
          </p>
          <div className="form-actions">
            <button className="button primary" disabled={!kitId} onClick={start}>
              Write 3 options
            </button>
            <button className="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      )}
      {running && <p className="muted">{PROGRESS[generation.status]}</p>}
      {generation?.status === 'failed' && (
        <p className="error">
          {generation.error}{' '}
          <button className="link-button" onClick={() => setGeneration(undefined)}>
            Try again
          </button>
        </p>
      )}
      {generation?.status === 'ready' && (
        <div className="template-grid">
          {(generation.variants ?? []).map((variant, index) => (
            <div key={variant.templateId} className="template-card">
              <span className="template-card-preview">
                {templates[variant.templateId] && (
                  <VariantPreview
                    template={templates[variant.templateId]}
                    values={variant.values}
                    urls={urls}
                  />
                )}
              </span>
              <span className="template-card-name">{variant.templateName}</span>
              {variant.confirmed.length > 0 && (
                <span className="hint">To fill in: {variant.confirmed.join(', ')}</span>
              )}
              <button className="button primary small" onClick={() => open(index, variant)}>
                Edit this one
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
