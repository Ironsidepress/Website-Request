'use client';

import { use, useCallback, useEffect, useState } from 'react';

interface Timeline {
  project: { id: string; name: string; status: string };
  stages: Array<{ stage: string; title: string; status: string; waitingOnYou: boolean }>;
  events: Array<{ at: string; description: string }>;
}

interface PendingApproval {
  id: string;
  gate: string;
  stageAttempt: number;
  requestedAt: string;
  expiresAt: string;
  canDecide: boolean;
  reviewUrl?: string;
}

const GATE_PROMPTS: Record<string, string> = {
  design_review: 'Please review the design for your website',
  preview_review: 'Please review the preview of your website',
  production_approval: 'Launch approval is being handled by our team',
};

function ApprovalActions({
  organizationId,
  approval,
  onDecided,
}: {
  organizationId: string;
  approval: PendingApproval;
  onDecided: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const decide = async (decision: 'approved' | 'rejected') => {
    setBusy(true);
    setError(null);
    const response = await fetch(
      `/api/organizations/${organizationId}/approvals/${approval.id}/decision`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
      },
    );
    setBusy(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Something went wrong — please try again');
      return;
    }
    onDecided();
  };

  return (
    <section data-testid={`approval-${approval.gate}`}>
      <p role="alert">
        <strong>Action needed:</strong> {GATE_PROMPTS[approval.gate] ?? 'Approval requested'}
        {approval.reviewUrl ? (
          <>
            {' — '}
            <a href={approval.reviewUrl} target="_blank" rel="noopener noreferrer">
              open the design
            </a>
          </>
        ) : null}
      </p>
      <label>
        Feedback (required when requesting changes)
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          disabled={busy}
        />
      </label>
      <p>
        <button type="button" onClick={() => void decide('approved')} disabled={busy}>
          Approve
        </button>{' '}
        <button type="button" onClick={() => void decide('rejected')} disabled={busy}>
          Request changes
        </button>
      </p>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

export default function ProjectTimelinePage({
  params,
}: {
  params: Promise<{ id: string; projectId: string }>;
}) {
  const { id, projectId } = use(params);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const [timelineResponse, approvalsResponse] = await Promise.all([
      fetch(`/api/organizations/${id}/projects/${projectId}/timeline`),
      fetch(`/api/organizations/${id}/projects/${projectId}/approvals`),
    ]);
    if (!timelineResponse.ok) {
      setFailed(true);
      return;
    }
    setTimeline((await timelineResponse.json()) as Timeline);
    setApprovals(
      approvalsResponse.ok ? ((await approvalsResponse.json()) as PendingApproval[]) : [],
    );
  }, [id, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return (
      <main>
        <p>
          Project not available. <a href="/">Back</a>
        </p>
      </main>
    );
  }
  if (!timeline) return <main>Loading…</main>;

  const actionable = approvals.filter((approval) => approval.canDecide);
  const waiting = timeline.stages.find((stage) => stage.waitingOnYou);

  return (
    <main>
      <p>
        <a href={`/organizations/${id}`}>← Back to organization</a>
      </p>
      <h1>{timeline.project.name}</h1>
      {timeline.project.status === 'on_hold' ? (
        <p role="alert">
          <strong>On hold:</strong> our team is looking into this project — no action needed from
          you right now.
        </p>
      ) : null}
      {actionable.map((approval) => (
        <ApprovalActions
          key={approval.id}
          organizationId={id}
          approval={approval}
          onDecided={() => void load()}
        />
      ))}
      {actionable.length === 0 && waiting ? (
        <p role="alert">
          <strong>Action needed:</strong> {waiting.title}
        </p>
      ) : null}

      <h2>Progress</h2>
      <ol data-testid="timeline-stages">
        {timeline.stages.map((stage) => (
          <li key={stage.stage}>
            {stage.status === 'done' ? '✓' : stage.status === 'active' ? '●' : '○'} {stage.title}
            {stage.waitingOnYou ? ' — waiting on you' : ''}
          </li>
        ))}
      </ol>

      <h2>Updates</h2>
      <ul data-testid="timeline-events">
        {timeline.events.map((event, index) => (
          <li key={index}>
            {new Date(event.at).toLocaleString()} — {event.description}
          </li>
        ))}
      </ul>
    </main>
  );
}
