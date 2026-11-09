import { useEffect, useState } from 'react';
import { api, errorText } from '../../lib/api';

type Status = 'queued' | 'browsing' | 'processing' | 'analyzing' | 'ready' | 'failed';

interface Scan {
  scanId: string;
  url: string;
  status: Status;
  error?: string;
  pages?: Array<{ url: string; title: string }>;
  brandKitId?: string;
}

interface Palette {
  primary: string;
  secondary?: string;
  accent: string;
  text: string;
  background: string;
}

interface ScanResult {
  url: string;
  pages: Array<{ url: string; title: string }>;
  logo: {
    choice: { logoIndex: number | null; background: string; reason: string };
    candidates: Array<{
      index: number;
      previewUrl: string;
      tone: string;
      source: { kind: string; alt?: string };
    }>;
  };
  palette: Palette;
  photos: Array<{
    index: number;
    url: string;
    label?: string;
    quality?: number;
    description?: string;
    alt: string;
  }>;
  content: {
    businessName: string;
    tagline: string | null;
    services: Array<{ name: string; description: string }>;
    offers: Array<{ text: string; quote: string; sourceUrl: string }>;
    ctas: string[];
    dropped: { offers: number; ctas: number };
  };
  draft: { name: string; logoIndex: number | null; photoIndexes: number[] };
  skipped: string[];
}

const STEPS: Array<[Status, string]> = [
  ['queued', 'Starting'],
  ['browsing', 'Reading the website'],
  ['processing', 'Collecting logos, photos and colours'],
  ['analyzing', 'Picking the logo and reading services and offers'],
];
const POLL_MS = 3000;
const ROLES: Array<keyof Palette> = ['primary', 'secondary', 'accent', 'text', 'background'];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function Review({
  clientId,
  scan,
  result,
  onSaved,
}: {
  clientId: string;
  scan: Scan;
  result: ScanResult;
  onSaved: () => void;
}) {
  const [name, setName] = useState(result.draft.name);
  const [logoIndex, setLogoIndex] = useState<number | null>(result.draft.logoIndex);
  const [colors, setColors] = useState<Palette>(result.palette);
  const [photos, setPhotos] = useState<number[]>(result.draft.photoIndexes);
  const [services, setServices] = useState<string[]>(
    result.content.services.map((service) => service.name),
  );
  const [offers, setOffers] = useState<string[]>(result.content.offers.map((offer) => offer.quote));
  const [ctas, setCtas] = useState<string[]>(result.content.ctas);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/clients/${clientId}/scans/${scan.scanId}/brand-kit`, {
        method: 'POST',
        body: {
          name,
          logoIndex,
          photoIndexes: photos,
          colors: Object.fromEntries(Object.entries(colors).filter(([, value]) => value)),
          services: result.content.services.filter((service) => services.includes(service.name)),
          offerQuotes: offers,
          ctas,
        },
      });
      onSaved();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scan-review">
      <p className="muted">
        Found on {result.pages.length} page{result.pages.length === 1 ? '' : 's'} of{' '}
        <a href={result.url} target="_blank" rel="noreferrer">
          {result.url}
        </a>
        . Nothing is saved until you check it and press Save.
      </p>
      <label className="field">
        Brand kit name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>

      <h3>Logo</h3>
      {result.logo.candidates.length === 0 && (
        <p className="muted">No logo was found. Upload one in Photos and logos.</p>
      )}
      <div className="scan-logos">
        {result.logo.candidates.map((candidate) => (
          <button
            key={candidate.index}
            className={`scan-logo${logoIndex === candidate.index ? ' chosen' : ''}`}
            onClick={() => setLogoIndex(logoIndex === candidate.index ? null : candidate.index)}
          >
            <img
              src={candidate.previewUrl}
              alt={candidate.source.alt || `Logo candidate ${candidate.index + 1}`}
            />
            {result.logo.choice.logoIndex === candidate.index && (
              <span className="badge active">suggested</span>
            )}
          </button>
        ))}
      </div>
      {result.logo.choice.reason && <p className="hint">{result.logo.choice.reason}</p>}

      <h3>Colours</h3>
      <div className="color-grid">
        {ROLES.map((role) => (
          <label key={role} className="field">
            {role}
            <span className="color-input">
              <input
                type="color"
                value={colors[role] ?? '#000000'}
                onChange={(event) => setColors({ ...colors, [role]: event.target.value })}
              />
              <input
                value={colors[role] ?? ''}
                placeholder="none"
                onChange={(event) =>
                  setColors({ ...colors, [role]: event.target.value || undefined })
                }
              />
            </span>
          </label>
        ))}
      </div>

      <h3>Photos</h3>
      {result.photos.length === 0 && <p className="muted">No usable photos were found.</p>}
      <div className="asset-grid small">
        {result.photos.map((photo) => (
          <button
            key={photo.index}
            className={`asset-choice${photos.includes(photo.index) ? ' chosen' : ''}`}
            title={`${photo.label ?? ''} ${photo.quality ? `${photo.quality}/5` : ''} ${photo.description ?? photo.alt}`}
            onClick={() => setPhotos(toggle(photos, photo.index))}
          >
            <img src={photo.url} alt={photo.description ?? photo.alt} />
          </button>
        ))}
      </div>

      <h3>Services</h3>
      <ul className="plain-list">
        {result.content.services.map((service) => (
          <li key={service.name}>
            <label className="toggle">
              <input
                type="checkbox"
                checked={services.includes(service.name)}
                onChange={() => setServices(toggle(services, service.name))}
              />
              <span>
                <strong>{service.name}</strong> <span className="muted">{service.description}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <h3>Offers</h3>
      {result.content.offers.length === 0 && (
        <p className="muted">
          No offers were found on the website. Ads will use [confirm] where an offer goes.
        </p>
      )}
      <ul className="plain-list">
        {result.content.offers.map((offer) => (
          <li key={offer.quote}>
            <label className="toggle">
              <input
                type="checkbox"
                checked={offers.includes(offer.quote)}
                onChange={() => setOffers(toggle(offers, offer.quote))}
              />
              <span>
                <strong>{offer.text}</strong>{' '}
                <span className="muted">
                  "{offer.quote}" on{' '}
                  <a href={offer.sourceUrl} target="_blank" rel="noreferrer">
                    {new URL(offer.sourceUrl).pathname}
                  </a>
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {result.content.dropped.offers > 0 && (
        <p className="hint">
          {result.content.dropped.offers} suggested offer(s) were removed because their wording is
          not on the website.
        </p>
      )}

      <h3>Calls to action</h3>
      <div className="lock-list">
        {result.content.ctas.map((cta) => (
          <label key={cta} className="toggle">
            <input
              type="checkbox"
              checked={ctas.includes(cta)}
              onChange={() => setCtas(toggle(ctas, cta))}
            />
            {cta}
          </label>
        ))}
      </div>

      {result.skipped.length > 0 && (
        <details>
          <summary className="muted">{result.skipped.length} item(s) could not be used</summary>
          <ul className="hint">
            {result.skipped.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="form-actions">
        <button className="button primary" disabled={busy || !name.trim()} onClick={save}>
          Save as brand kit
        </button>
        {error && <span className="error">{error}</span>}
      </div>
    </div>
  );
}

export function ScanPanel({ clientId, onSaved }: { clientId: string; onSaved: () => void }) {
  const [url, setUrl] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [scan, setScan] = useState<Scan | undefined>();
  const [result, setResult] = useState<ScanResult | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!scan || scan.status === 'ready' || scan.status === 'failed') {
      return;
    }
    const timer = setInterval(async () => {
      try {
        const latest = await api<{ scan: Scan; result?: ScanResult }>(
          `/clients/${clientId}/scans/${scan.scanId}`,
        );
        setScan(latest.scan);
        setResult(latest.result);
      } catch (reason) {
        setError(errorText(reason));
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [clientId, scan]);

  const start = async () => {
    setError(undefined);
    setResult(undefined);
    try {
      setScan(
        await api<Scan>(`/clients/${clientId}/scans`, {
          method: 'POST',
          body: { url, confirmOwnership: confirmed },
        }),
      );
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  const running = scan && scan.status !== 'ready' && scan.status !== 'failed';
  const stepIndex = STEPS.findIndex(([status]) => status === scan?.status);

  return (
    <div className="panel scan-panel">
      <h2>Build a brand kit from a website</h2>
      {!running && !result && (
        <>
          <div className="inline-form">
            <input
              type="url"
              placeholder="https://your-business.com"
              aria-label="Website address"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <button className="button primary" disabled={!url.trim() || !confirmed} onClick={start}>
              Scan website
            </button>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I own or represent this website and have the right to use its logos, photos and text in
            ads.
          </label>
        </>
      )}
      {running && (
        <ol className="scan-steps">
          {STEPS.map(([status, label], index) => (
            <li
              key={status}
              className={index < stepIndex ? 'done' : index === stepIndex ? 'current' : undefined}
            >
              {label}
            </li>
          ))}
        </ol>
      )}
      {scan?.status === 'failed' && <p className="error">{scan.error}</p>}
      {error && <p className="error">{error}</p>}
      {scan && result && (
        <Review clientId={clientId} scan={scan} result={result} onSaved={onSaved} />
      )}
    </div>
  );
}
