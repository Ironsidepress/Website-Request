import { saveSectionInputSchema } from '@website-factory/schemas';

import { handleApi, requirePrincipal } from '@/lib/api';
import { getServices } from '@/lib/services';

/**
 * Autosave one questionnaire section. Stale `baseRevision` values surface as
 * 409 so multi-tab editing never silently loses data.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; sectionId: string }> },
): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const { id, sectionId } = await context.params;
    const input = saveSectionInputSchema.parse(await request.json());
    const { intake } = await getServices();
    const view = await intake.saveSection(principal, id, sectionId, input);
    return Response.json(view);
  });
}
