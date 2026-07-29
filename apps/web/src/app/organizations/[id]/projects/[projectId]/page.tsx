'use client';

import { use, useEffect, useState } from 'react';

interface Timeline {
  project: { id: string; name: string; status: string };
  stages: Array<{ stage: string; title: string; status: string; waitingOnYou: boolean }>;
  events: Array<{ at: string; description: string }>;
}

export default function ProjectTimelinePage({
  params,
}: {
  params: Promise<{ id: string; projectId: string }>;
}) {
  const { id, projectId } = use(params);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await fetch(`/api/organizations/${id}/projects/${projectId}/timeline`);
      if (!response.ok) {
        setFailed(true);
        return;
      }
      setTimeline((await response.json()) as Timeline);
    })();
  }, [id, projectId]);

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

  const waiting = timeline.stages.find((stage) => stage.waitingOnYou);

  return (
    <main>
      <p>
        <a href={`/organizations/${id}`}>← Back to organization</a>
      </p>
      <h1>{timeline.project.name}</h1>
      {waiting ? (
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
