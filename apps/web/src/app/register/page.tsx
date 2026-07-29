'use client';

import { useState, type FormEvent } from 'react';

import { authClient } from '@/lib/auth-client';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('submitting');
    setError(null);
    const { error: signUpError } = await authClient.signUp.email({ name, email, password });
    if (signUpError) {
      setError(signUpError.message ?? 'Registration failed');
      setStatus('idle');
      return;
    }
    setStatus('done');
  }

  if (status === 'done') {
    return (
      <main>
        <h1>Check your email</h1>
        <p>
          We sent a verification link to <strong>{email}</strong>. Verify your address, then{' '}
          <a href="/login">sign in</a>.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Create your account</h1>
      <form onSubmit={onSubmit}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
        </label>
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
            minLength={8}
            maxLength={128}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={status === 'submitting'}>
          Register
        </button>
      </form>
      <p>
        Already have an account? <a href="/login">Sign in</a>
      </p>
    </main>
  );
}
