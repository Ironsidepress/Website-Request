'use client';

import { useState, type FormEvent } from 'react';

import { authClient } from '@/lib/auth-client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    // Always report success — never reveal whether an account exists.
    await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' });
    setDone(true);
  }

  if (done) {
    return (
      <main>
        <h1>Check your email</h1>
        <p>If an account exists for {email}, a password reset link is on its way.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Reset your password</h1>
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
        <button type="submit">Send reset link</button>
      </form>
    </main>
  );
}
