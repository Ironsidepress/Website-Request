'use client';

import { useCallback, useEffect, useState } from 'react';

interface ProjectRow {
  project: {
    id: string;
    name: string;
    currentStage: string;
    status: string;
    health: string;
    createdAt: string;
  };
  organizationName: string;
  pendingApprovals: number;
}

interface QueueRow {
  approval: { id: string; gate: string; projectId: string; requestedAt: string };
  organizationName: string;
  projectName: string;
}

/**
 * Staff dashboard (acceptance §5): cross-tenant project table with filters
 * plus the pending-approvals queue. Non-staff get a 404 from the API and see
 * the not-available message — the page reveals nothing.
 */
export default function StaffDashboardPage() {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [status, setStatus] = useState('');
  const [health, setHealth] = useState('');
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (health) query.set('health', health);
    const [projectsResponse, queueResponse] = await Promise.all([
      fetch(`/api/staff/projects?${query.toString()}`),
      fetch('/api/staff/approvals'),
    ]);
    if (!projectsResponse.ok) {
      setFailed(true);
      return;
    }
    setProjects((await projectsResponse.json()) as ProjectRow[]);
    setQueue(queueResponse.ok ? ((await queueResponse.json()) as QueueRow[]) : []);
  }, [status, health]);

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
  if (!projects) return <main>Loading…</main>;

  return (
    <main>
      <h1>Staff dashboard</h1>

      <h2>Pending approvals ({queue.length})</h2>
      <ul data-testid="staff-approval-queue">
        {queue.map((row) => (
          <li key={row.approval.id}>
            <a href={`/staff/projects/${row.approval.projectId}`}>
              {row.organizationName} — {row.projectName}
            </a>{' '}
            · {row.approval.gate} · requested {new Date(row.approval.requestedAt).toLocaleString()}
          </li>
        ))}
        {queue.length === 0 ? <li>Nothing waiting.</li> : null}
      </ul>

      <h2>Projects</h2>
      <p>
        <label>
          Status{' '}
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">all</option>
            <option value="active">active</option>
            <option value="on_hold">on hold</option>
            <option value="cancelled">cancelled</option>
            <option value="completed">completed</option>
          </select>
        </label>{' '}
        <label>
          Health{' '}
          <select value={health} onChange={(e) => setHealth(e.target.value)}>
            <option value="">all</option>
            <option value="ok">ok</option>
            <option value="needs_attention">needs attention</option>
          </select>
        </label>
      </p>
      <table data-testid="staff-projects">
        <thead>
          <tr>
            <th>Organization</th>
            <th>Project</th>
            <th>Stage</th>
            <th>Status</th>
            <th>Health</th>
            <th>Pending gates</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((row) => (
            <tr key={row.project.id}>
              <td>{row.organizationName}</td>
              <td>
                <a href={`/staff/projects/${row.project.id}`}>{row.project.name}</a>
              </td>
              <td>{row.project.currentStage}</td>
              <td>{row.project.status}</td>
              <td>{row.project.health === 'needs_attention' ? '⚠ needs attention' : 'ok'}</td>
              <td>{row.pendingApprovals}</td>
              <td>{new Date(row.project.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
