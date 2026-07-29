'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';

import { authClient } from '@/lib/auth-client';

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const { error: resetError } = await authClient.resetPassword({ newPassword: password, token });
    if (resetError) {
      setError(resetError.message ?? 'Password reset failed');
      return;
    }
    setDone(true);
  }

  if (!token) {
    return <p>This reset link is invalid. Request a new one from the sign-in page.</p>;
  }

  if (done) {
    return (
      <p>
        Your password has been reset. <a href="/login">Sign in</a>
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <label>
        New password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          maxLength={128}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit">Set new password</button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main>
      <h1>Choose a new password</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
