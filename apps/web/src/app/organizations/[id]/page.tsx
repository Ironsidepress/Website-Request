'use client';

import { use, useEffect, useState, type FormEvent } from 'react';

interface Member {
  userId: string;
  role: string;
  name: string;
  email: string;
}

export default function OrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await fetch(`/api/organizations/${id}/members`);
      setMembers(response.ok ? ((await response.json()) as Member[]) : null);
    })();
  }, [id]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const response = await fetch(`/api/organizations/${id}/invitations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, role: 'member' }),
    });
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      setNotice(body.message ?? 'Could not send the invitation');
      return;
    }
    setNotice(`Invitation sent to ${inviteEmail}`);
    setInviteEmail('');
  }

  if (members === null) {
    return (
      <main>
        <p>
          Organization not available. <a href="/">Back</a>
        </p>
      </main>
    );
  }

  return (
    <main>
      <p>
        <a href="/">← Back</a>
      </p>
      <h1>Members</h1>
      <ul>
        {members.map((member) => (
          <li key={member.userId}>
            {member.name} ({member.email}) — {member.role}
          </li>
        ))}
      </ul>

      <h2>Invite a member</h2>
      <form onSubmit={invite}>
        <label>
          Email
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
            maxLength={254}
          />
        </label>
        <button type="submit">Invite</button>
      </form>
      {notice ? <p role="status">{notice}</p> : null}
    </main>
  );
}
