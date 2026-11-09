import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { Brand } from '../app/Brand';
import { api, errorText } from '../lib/api';
import { beginTotpSetup, finishTotpSetup } from '../lib/auth';
import type { Branding, Me } from '../lib/types';

export function MfaSetup({
  branding,
  me,
  onDone,
  onSignOut,
}: {
  branding: Branding;
  me: Me;
  onDone: () => void;
  onSignOut: () => void;
}) {
  const [qr, setQr] = useState<string | undefined>();
  const [secret, setSecret] = useState<string | undefined>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    beginTotpSetup(branding.appName || 'AdStudio', me.user.email)
      .then(async (uri) => {
        setSecret(new URL(uri).searchParams.get('secret') ?? undefined);
        setQr(await QRCode.toDataURL(uri, { margin: 1, width: 220 }));
      })
      .catch((reason) => setError(errorText(reason)));
  }, [branding.appName, me.user.email]);

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await finishTotpSetup(code.trim());
      await api('/me/mfa', { method: 'POST' });
      onDone();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Brand branding={branding} />
        <form onSubmit={confirm}>
          <h1>Set up two-step sign-in</h1>
          <p className="muted">
            Staff accounts need an authenticator app (Google Authenticator, 1Password, Authy and
            similar). Scan the code, then enter the 6-digit number it shows.
          </p>
          {qr ? (
            <img src={qr} alt="QR code for your authenticator app" className="mfa-qr" />
          ) : (
            <p className="muted">Preparing...</p>
          )}
          {secret && (
            <p className="hint">
              Can't scan? Enter this key: <code>{secret}</code>
            </p>
          )}
          <label>
            Code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="button primary" disabled={busy || !qr}>
            Turn on two-step sign-in
          </button>
          <button type="button" className="link-button" onClick={onSignOut}>
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
