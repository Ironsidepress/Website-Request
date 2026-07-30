import { assembleGeneratedPage, renderPreviewSite } from '@website-factory/core';
import {
  createIntakesRepository,
  createPipelineRepository,
  createStaffRepository,
  tenantContext,
} from '@website-factory/db';

import { getServices } from '@/lib/services';

/**
 * Public preview of a client's in-progress website (preview_review gate).
 *
 * Unauthenticated by design so clients can share the link, but gated by the
 * unguessable token minted into the preview_deployment artifact's external
 * ref — a wrong or missing token is a plain 404. Marked noindex; rendered on
 * demand from the latest content_plan + creative_brief artifacts so the page
 * always shows exactly what the gate is approving. The projectId lookup is
 * cross-tenant by necessity (no principal); every subsequent read is
 * tenant-scoped to the project's own organization.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  const notFound = new Response('Not found', { status: 404 });
  const { projectId } = await context.params;
  const token = new URL(request.url).searchParams.get('t');
  if (!token) return notFound;

  const { db } = await getServices();
  const staff = createStaffRepository(db);
  const pipeline = createPipelineRepository(db);
  const intakes = createIntakesRepository(db);

  const project = await staff.findProjectById(projectId);
  if (!project) return notFound;
  const ctx = tenantContext(project.organizationId);

  const deployment = await pipeline.latestArtifact(ctx, projectId, 'preview_deployment');
  if (!deployment?.externalRef) return notFound;
  const ref = JSON.parse(deployment.externalRef) as { token?: unknown };
  if (typeof ref.token !== 'string' || ref.token !== token) return notFound;

  const [plan, brief, code, intake] = await Promise.all([
    pipeline.latestArtifact(ctx, projectId, 'content_plan'),
    pipeline.latestArtifact(ctx, projectId, 'creative_brief'),
    pipeline.latestArtifact(ctx, projectId, 'code_change'),
    intakes.findById(ctx, project.intakeId),
  ]);
  const intakeData = intake ? (JSON.parse(intake.data) as Record<string, unknown>) : {};
  const business = (intakeData.business ?? {}) as { displayName?: string };
  const businessName = business.displayName ?? project.name;

  // Once the developer agent has implemented the site (ADR-0018) the preview
  // serves that generated code; before then it renders the content plan
  // through the platform template so the gate always has something to review.
  const generated = code?.content
    ? assembleGeneratedPage({
        businessName,
        code: JSON.parse(code.content),
        path: new URL(request.url).searchParams.get('p') ?? '/',
      })
    : null;

  const html =
    generated?.html ??
    renderPreviewSite({
      businessName,
      contentPlan: plan?.content ? JSON.parse(plan.content) : null,
      creativeBrief: brief?.content ? JSON.parse(brief.content) : null,
    });
  if (!html) {
    return new Response('This preview is not ready yet.', {
      status: 404,
      headers: { 'x-robots-tag': 'noindex' },
    });
  }
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-robots-tag': 'noindex',
      // Generated markup is inert by contract; this makes it inert by policy
      // too — no scripts, no network egress, only inline styles and data URIs.
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}
