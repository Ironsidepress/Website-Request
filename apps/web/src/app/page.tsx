'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { authClient } from '@/lib/auth-client';

interface Me {
  user: { id: string; email: string; name: string; emailVerified: boolean };
  organizations: Array<{ id: string; name: string; role: string }>;
}

export default function HomePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgName, setOrgName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch('/api/me');
    setMe(response.ok ? ((await response.json()) as Me) : null);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createOrganization(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const response = await fetch('/api/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: orgName, contactEmail }),
    });
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      setError(body.message ?? 'Could not create the organization');
      return;
    }
    setOrgName('');
    setContactEmail('');
    await refresh();
  }

  async function signOut() {
    await authClient.signOut();
    window.location.href = '/login';
  }

  if (loading) return <main>Loading…</main>;

  if (!me) {
    return (
      <main>
        <h1>Website Factory</h1>
        <p>Your website, produced for you — from a guided questionnaire to launch.</p>
        <p>
          <a href="/login">Sign in</a> or <a href="/register">create an account</a>.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Website Factory</h1>
      <p>
        Signed in as {me.user.name} ({me.user.email}){' '}
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      </p>

      <h2>Your organizations</h2>
      {me.organizations.length === 0 ? (
        <p>No organization yet — create one for your business below.</p>
      ) : (
        <ul>
          {me.organizations.map((org) => (
            <li key={org.id}>
              <a href={`/organizations/${org.id}`}>{org.name}</a> ({org.role})
            </li>
          ))}
        </ul>
      )}

      <h3>Create an organization</h3>
      <form onSubmit={createOrganization}>
        <label>
          Business name
          <input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            required
            maxLength={200}
          />
        </label>
        <label>
          Contact email
          <input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            required
            maxLength={254}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit">Create</button>
      </form>
    </main>
  );
}
