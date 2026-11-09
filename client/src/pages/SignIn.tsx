import { useState, type FormEvent } from 'react';
import { Brand } from '../app/Brand';
import { errorText } from '../lib/api';
import {
  finishPasswordReset,
  requestPasswordReset,
  setNewPassword,
  startSignIn,
} from '../lib/auth';
import type { Branding } from '../lib/types';

type Step = 'sign-in' | 'new-password' | 'forgot' | 'reset';

const PASSWORD_HINT =
  'At least 12 characters with upper and lower case letters, a number and a symbol.';

export function SignIn({ branding, onSignedIn }: { branding: Branding; onSignedIn: () => void }) {
  const [step, setStep] = useState<Step>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = (action: () => Promise<void>) => async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const go = (next: Step) => {
    setError(undefined);
    setNotice(undefined);
    setPassword('');
    setStep(next);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Brand branding={branding} />
        {step === 'sign-in' && (
          <form
            onSubmit={submit(async () => {
              if ((await startSignIn(email.trim(), password)) === 'new-password') {
                go('new-password');
              } else {
                onSignedIn();
              }
            })}
          >
            <h1>Sign in</h1>
            {notice && <p className="notice">{notice}</p>}
            <label>
              Email
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="button primary" disabled={busy}>
              Sign in
            </button>
            <button type="button" className="link-button" onClick={() => go('forgot')}>
              Forgot password?
            </button>
          </form>
        )}
        {step === 'new-password' && (
          <form
            onSubmit={submit(async () => {
              await setNewPassword(password);
              onSignedIn();
            })}
          >
            <h1>Choose a password</h1>
            <p className="muted">Replace the temporary password from your invitation.</p>
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <p className="hint">{PASSWORD_HINT}</p>
            {error && <p className="error">{error}</p>}
            <button className="button primary" disabled={busy}>
              Save and continue
            </button>
          </form>
        )}
        {step === 'forgot' && (
          <form
            onSubmit={submit(async () => {
              await requestPasswordReset(email.trim());
              go('reset');
            })}
          >
            <h1>Reset password</h1>
            <label>
              Email
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="button primary" disabled={busy}>
              Email me a code
            </button>
            <button type="button" className="link-button" onClick={() => go('sign-in')}>
              Back to sign in
            </button>
          </form>
        )}
        {step === 'reset' && (
          <form
            onSubmit={submit(async () => {
              await finishPasswordReset(email.trim(), code.trim(), password);
              go('sign-in');
              setNotice('Password changed. Sign in with your new password.');
            })}
          >
            <h1>Enter the code</h1>
            <p className="muted">If {email} has an account, a code is on its way.</p>
            <label>
              Code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <p className="hint">{PASSWORD_HINT}</p>
            {error && <p className="error">{error}</p>}
            <button className="button primary" disabled={busy}>
              Change password
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
