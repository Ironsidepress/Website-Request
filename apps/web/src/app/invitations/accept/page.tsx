'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function AcceptInvitation() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [message, setMessage] = useState('Accepting your invitation…');

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage('This invitation link is malformed.');
      return;
    }
    void (async () => {
      const response = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = (await response.json()) as { message?: string; kind?: string };
      if (response.status === 401) {
        setState('error');
        setMessage(
          'Please sign in (or register with the invited email address) first, then open the invitation link again.',
        );
        return;
      }
      if (!response.ok) {
        setState('error');
        setMessage(body.message ?? 'This invitation could not be accepted.');
        return;
      }
      setState('done');
      setMessage(
        body.kind === 'staff'
          ? 'Welcome aboard — your staff access is active.'
          : 'You have joined the organization.',
      );
    })();
  }, [token]);

  return (
    <>
      <p role={state === 'error' ? 'alert' : 'status'}>{message}</p>
      {state !== 'working' ? (
        <p>
          <a href="/">Go to your dashboard</a>
        </p>
      ) : null}
    </>
  );
}

export default function AcceptInvitationPage() {
  return (
    <main>
      <h1>Invitation</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <AcceptInvitation />
      </Suspense>
    </main>
  );
}
