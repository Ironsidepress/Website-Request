'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import type { IntakeSectionId, IntakeValidityMap } from '@website-factory/schemas';
import { computeIntakeValidity, INTAKE_SECTION_IDS } from '@website-factory/schemas';

import {
  AudiencesSection,
  BrandingSection,
  BusinessSection,
  CompetitorsSection,
  ContentSection,
  DomainSection,
  ExamplesSection,
  FunctionalitySection,
  ServicesSection,
} from './sections';

const SECTION_TITLES: Record<IntakeSectionId, string> = {
  business: 'Business profile',
  services: 'Services & offerings',
  audiences: 'Target audiences',
  competitors: 'Competitors',
  examples: 'Website examples',
  domain: 'Domain',
  branding: 'Branding',
  content: 'Content',
  functionality: 'Functionality',
};

const SECTION_COMPONENTS = {
  business: BusinessSection,
  services: ServicesSection,
  audiences: AudiencesSection,
  competitors: CompetitorsSection,
  examples: ExamplesSection,
  domain: DomainSection,
  branding: BrandingSection,
  content: ContentSection,
  functionality: FunctionalitySection,
} as const;

interface IntakeState {
  revision: number;
  data: Record<string, unknown>;
  validity: IntakeValidityMap;
}

type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'conflict' | 'error';

export default function IntakeWizardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: organizationId } = use(params);
  const [intake, setIntake] = useState<IntakeState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [active, setActive] = useState<IntakeSectionId>('business');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [confirmAccuracy, setConfirmAccuracy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The autosave engine: latest state lives in refs so the debounced flush
  // always sends the newest data with the correct base revision.
  const stateRef = useRef<IntakeState | null>(null);
  const dirtySectionRef = useRef<IntakeSectionId | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/organizations/${organizationId}/intake`);
    if (!response.ok) {
      setLoadError(true);
      return;
    }
    const view = (await response.json()) as IntakeState;
    stateRef.current = view;
    setIntake(view);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const flush = useCallback(async () => {
    const state = stateRef.current;
    const section = dirtySectionRef.current;
    if (!state || !section) return;
    dirtySectionRef.current = null;
    setSaveStatus('saving');

    const response = await fetch(
      `/api/organizations/${organizationId}/intake/sections/${section}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseRevision: state.revision,
          data: state.data[section] ?? {},
        }),
      },
    );

    if (response.status === 409) {
      // Another tab (or device) saved first: reload server state — nothing is
      // silently overwritten.
      setSaveStatus('conflict');
      await load();
      return;
    }
    if (!response.ok) {
      setSaveStatus('error');
      return;
    }
    const view = (await response.json()) as IntakeState;
    // Keep local edits made while the request was in flight; adopt the
    // server's revision and validity.
    const merged: IntakeState = {
      revision: view.revision,
      data: { ...view.data, ...(dirtySectionRef.current ? stateRef.current?.data : {}) },
      validity: view.validity,
    };
    stateRef.current = {
      ...merged,
      data: stateRef.current?.data ?? merged.data,
      revision: view.revision,
    };
    setIntake((current) =>
      current ? { ...current, revision: view.revision, validity: view.validity } : current,
    );
    setSaveStatus(dirtySectionRef.current ? 'pending' : 'saved');
    if (dirtySectionRef.current) scheduleFlush();
  }, [organizationId, load]);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), 800);
  }, [flush]);

  const updateSection = useCallback(
    (section: IntakeSectionId, value: unknown) => {
      setIntake((current) => {
        if (!current) return current;
        const data = { ...current.data, [section]: value };
        const next = { ...current, data, validity: computeIntakeValidity(data) };
        stateRef.current = next;
        return next;
      });
      dirtySectionRef.current = section;
      setSaveStatus('pending');
      scheduleFlush();
    },
    [scheduleFlush],
  );

  if (loadError) {
    return (
      <main>
        <p>
          Questionnaire not available. <a href="/">Back</a>
        </p>
      </main>
    );
  }
  if (!intake) return <main>Loading…</main>;

  const ActiveSection = SECTION_COMPONENTS[active];
  const statusLabel: Record<SaveStatus, string> = {
    idle: '',
    pending: 'Unsaved changes…',
    saving: 'Saving…',
    saved: 'All changes saved',
    conflict: 'Updated elsewhere — reloaded latest version',
    error: 'Could not save — retrying on next change',
  };

  return (
    <main>
      <p>
        <a href="/">← Back to dashboard</a>
      </p>
      <h1>Website questionnaire</h1>
      <p role="status" data-testid="save-status">
        {statusLabel[saveStatus]}
      </p>
      <nav aria-label="Sections">
        <ol>
          {INTAKE_SECTION_IDS.map((section) => {
            const validity = intake.validity[section];
            const marker = validity.valid ? '✓' : validity.started ? '●' : '○';
            return (
              <li key={section}>
                <button
                  type="button"
                  data-testid={`nav-${section}`}
                  onClick={() => setActive(section)}
                  style={{ fontWeight: active === section ? 700 : 400 }}
                >
                  {marker} {SECTION_TITLES[section]}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section aria-label={SECTION_TITLES[active]}>
        <h2>{SECTION_TITLES[active]}</h2>
        <ActiveSection
          value={intake.data[active]}
          organizationId={organizationId}
          onChange={(value: unknown) => updateSection(active, value)}
        />
        {!intake.validity[active].valid && intake.validity[active].started ? (
          <aside data-testid="section-issues">
            <h3>Still needed</h3>
            <ul>
              {intake.validity[active].issues.slice(0, 8).map((issue, index) => (
                <li key={index}>
                  {issue.path ? `${issue.path}: ` : ''}
                  {issue.message}
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </section>

      <section aria-label="Review and submit">
        <h2>Review &amp; submit</h2>
        {INTAKE_SECTION_IDS.every((section) => intake.validity[section].valid) ? (
          <>
            <label style={{ display: 'block', margin: '0.5rem 0' }}>
              <input
                type="checkbox"
                checked={confirmAccuracy}
                onChange={(e) => setConfirmAccuracy(e.target.checked)}
              />{' '}
              I confirm the information provided is accurate.
            </label>
            {submitError ? <p role="alert">{submitError}</p> : null}
            <button
              type="button"
              disabled={
                !confirmAccuracy ||
                submitting ||
                saveStatus === 'pending' ||
                saveStatus === 'saving'
              }
              onClick={async () => {
                setSubmitting(true);
                setSubmitError(null);
                const response = await fetch(`/api/organizations/${organizationId}/intake/submit`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ confirmAccuracy }),
                });
                const body = (await response.json()) as { projectId?: string; message?: string };
                if (!response.ok || !body.projectId) {
                  setSubmitError(body.message ?? 'Submission failed — please review your answers');
                  setSubmitting(false);
                  return;
                }
                window.location.href = `/organizations/${organizationId}/projects/${body.projectId}`;
              }}
            >
              Submit questionnaire
            </button>
          </>
        ) : (
          <p>
            <em>Submit unlocks once every section shows a ✓.</em>
          </p>
        )}
      </section>
    </main>
  );
}
