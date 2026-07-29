'use client';

import { use, useCallback, useEffect, useState } from 'react';

interface Detail {
  project: {
    id: string;
    organizationId: string;
    name: string;
    currentStage: string;
    status: string;
    health: string;
    createdAt: string;
  };
  organizationName: string;
  history: Array<{
    id: string;
    fromStage: string | null;
    toStage: string;
    attempt: number;
    eventType: string | null;
    clientVisible: boolean;
    createdAt: string;
  }>;
  approvals: Array<{
    id: string;
    gate: string;
    stageAttempt: number;
    status: string;
    decisionReason: string | null;
    requestedAt: string;
  }>;
  agentRuns: Array<{
    id: string;
    agentType: string;
    promptVersion: string;
    model: string;
    status: string;
    retryCount: number;
    inputTokens: number | null;
    outputTokens: number | null;
    estimatedCostUsd: number | null;
    startedAt: string;
    completedAt: string | null;
  }>;
  artifacts: Array<{ artifactId: string; version: number; type: string; status: string }>;
  workflowRuns: Array<{ id: string; cfInstanceId: string; status: string; startedAt: string }>;
  intake: { status: string; data: Record<string, unknown> } | null;
  files: Array<{ id: string; filename: string; status: string; sizeBytes: number }>;
  audit: Array<{ id: string; action: string; actorId: string; createdAt: string }>;
}

function ActionButtons({ detail, onDone }: { detail: Detail; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const act = async (action: string) => {
    setError(null);
    const response = await fetch(`/api/staff/projects/${detail.project.id}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Action failed');
      return;
    }
    onDone();
  };

  const { status, health } = detail.project;
  return (
    <section>
      <h2>Actions</h2>
      <label>
        Reason (required for cancel){' '}
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <p>
        {status === 'active' ? (
          <button type="button" onClick={() => void act('hold')}>
            Hold
          </button>
        ) : null}{' '}
        {status === 'on_hold' ? (
          <button type="button" onClick={() => void act('resume')}>
            Resume
          </button>
        ) : null}{' '}
        {status === 'active' && health === 'needs_attention' ? (
          <button type="button" onClick={() => void act('retry')}>
            Retry
          </button>
        ) : null}{' '}
        {status !== 'completed' && status !== 'cancelled' ? (
          <button type="button" onClick={() => void act('cancel')}>
            Cancel project
          </button>
        ) : null}
      </p>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

function GateDecisions({ detail, onDone }: { detail: Detail; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pending = detail.approvals.filter((a) => a.status === 'pending');
  if (pending.length === 0) return null;

  const decide = async (approvalId: string, decision: 'approved' | 'rejected') => {
    setError(null);
    const response = await fetch(
      `/api/organizations/${detail.project.organizationId}/approvals/${approvalId}/decision`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
      },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Decision failed');
      return;
    }
    onDone();
  };

  return (
    <section>
      <h2>Pending gates</h2>
      <label>
        Reason (required to reject){' '}
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <ul>
        {pending.map((a) => (
          <li key={a.id}>
            {a.gate} (attempt {a.stageAttempt}){' '}
            <button type="button" onClick={() => void decide(a.id, 'approved')}>
              Approve
            </button>{' '}
            <button type="button" onClick={() => void decide(a.id, 'rejected')}>
              Reject
            </button>
          </li>
        ))}
      </ul>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

/** Staff project detail: the full internal record (acceptance §5). */
export default function StaffProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/staff/projects/${projectId}`);
    if (!response.ok) {
      setFailed(true);
      return;
    }
    setDetail((await response.json()) as Detail);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return (
      <main>
        <p>
          Not available. <a href="/">Back</a>
        </p>
      </main>
    );
  }
  if (!detail) return <main>Loading…</main>;

  return (
    <main>
      <p>
        <a href="/staff">← Back to dashboard</a>
      </p>
      <h1>
        {detail.organizationName} — {detail.project.name}
      </h1>
      <p>
        Stage <strong>{detail.project.currentStage}</strong> · status{' '}
        <strong>{detail.project.status}</strong> · health <strong>{detail.project.health}</strong>
      </p>

      <ActionButtons detail={detail} onDone={() => void load()} />
      <GateDecisions detail={detail} onDone={() => void load()} />

      <h2>Approvals</h2>
      <ul>
        {detail.approvals.map((a) => (
          <li key={a.id}>
            {a.gate} attempt {a.stageAttempt}: {a.status}
            {a.decisionReason ? ` — “${a.decisionReason}”` : ''}
          </li>
        ))}
      </ul>

      <h2>Agent runs</h2>
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>Prompt</th>
            <th>Model</th>
            <th>Status</th>
            <th>Retries</th>
            <th>Tokens in/out</th>
            <th>Est. cost</th>
          </tr>
        </thead>
        <tbody>
          {detail.agentRuns.map((run) => (
            <tr key={run.id}>
              <td>{run.agentType}</td>
              <td>{run.promptVersion}</td>
              <td>{run.model}</td>
              <td>{run.status}</td>
              <td>{run.retryCount}</td>
              <td>
                {run.inputTokens ?? '—'}/{run.outputTokens ?? '—'}
              </td>
              <td>{run.estimatedCostUsd != null ? `$${run.estimatedCostUsd.toFixed(4)}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Artifacts</h2>
      <ul>
        {detail.artifacts.map((a) => (
          <li key={`${a.artifactId}:${a.version}`}>
            {a.type} v{a.version} — {a.status}
          </li>
        ))}
      </ul>

      <h2>Stage history (full, including internal)</h2>
      <ul>
        {detail.history.map((h) => (
          <li key={h.id}>
            {new Date(h.createdAt).toLocaleString()} — {h.fromStage ?? '∅'} → {h.toStage} (attempt{' '}
            {h.attempt}, {h.eventType ?? 'event'}){h.clientVisible ? '' : ' · internal'}
          </li>
        ))}
      </ul>

      <h2>Workflow runs</h2>
      <ul>
        {detail.workflowRuns.map((run) => (
          <li key={run.id}>
            {run.cfInstanceId} — {run.status} (started {new Date(run.startedAt).toLocaleString()})
          </li>
        ))}
      </ul>

      <h2>Files</h2>
      <ul>
        {detail.files.map((file) => (
          <li key={file.id}>
            {file.filename} — {file.status} ({Math.ceil(file.sizeBytes / 1024)} KB)
          </li>
        ))}
        {detail.files.length === 0 ? <li>No uploads.</li> : null}
      </ul>

      <h2>Intake snapshot</h2>
      {detail.intake ? (
        <details>
          <summary>{detail.intake.status}</summary>
          <pre>{JSON.stringify(detail.intake.data, null, 2)}</pre>
        </details>
      ) : (
        <p>No intake.</p>
      )}

      <h2>Audit trail</h2>
      <ul>
        {detail.audit.map((entry) => (
          <li key={entry.id}>
            {new Date(entry.createdAt).toLocaleString()} — {entry.action} by {entry.actorId}
          </li>
        ))}
      </ul>
    </main>
  );
}
