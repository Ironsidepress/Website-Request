'use client';

import { useState, type FormEvent } from 'react';

import { authClient } from '@/lib/auth-client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await authClient.signIn.email({ email, password });
    if (signInError) {
      setError(signInError.message ?? 'Sign-in failed');
      setSubmitting(false);
      return;
    }
    window.location.href = '/';
  }

  return (
    <main>
      <h1>Sign in</h1>
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={254}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            maxLength={128}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={submitting}>
          Sign in
        </button>
      </form>
      <p>
        <a href="/forgot-password">Forgot your password?</a>
      </p>
      <p>
        New here? <a href="/register">Create an account</a>
      </p>
    </main>
  );
}
