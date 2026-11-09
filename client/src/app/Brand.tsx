import type { Branding } from '../lib/types';

export function Brand({ branding }: { branding: Branding }) {
  return (
    <span className="brand">
      {branding.logoUrl ? <img src={branding.logoUrl} alt="" className="brand-logo" /> : null}
      <span className="brand-name">{branding.appName}</span>
    </span>
  );
}
