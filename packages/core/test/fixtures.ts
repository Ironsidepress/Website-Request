import { INTAKE_SECTION_IDS } from '@website-factory/schemas';

import { registerVerifiedUser, type TestWorld } from './helpers';

export const PASSWORD = 'a-strong-password';

/** Section payloads that satisfy the strict intake schemas. */
export const COMPLETE_SECTIONS: Record<string, unknown> = {
  business: {
    legalName: 'Ironside Press LLC',
    displayName: 'Ironside Press',
    description: 'A letterpress print shop for small businesses and event stationery.',
    contact: { email: 'hello@ironsidepress.net' },
    serviceArea: 'local',
  },
  services: { offerings: [{ name: 'Wedding invitations', description: 'Letterpress suites' }] },
  audiences: {
    primaryAudience: { description: 'Engaged couples planning weddings', problems: 'Stationery' },
    tone: 'friendly',
  },
  competitors: {},
  examples: {},
  domain: { ownsDomain: false, desiredNames: ['ironsidepress.com'], purchaseConsent: true },
  branding: { hasBrandAssets: false, stylePreferences: ['classic'], needsLogoDesign: true },
  content: {
    contentReadiness: 'need_creation',
    needsCopywriting: true,
    needsPhotography: 'stock_ok',
  },
  functionality: { features: ['contact_form'], pageExpectations: 'up_to_5' },
};

/** Owner + organization with a fully completed intake draft, ready to submit. */
export async function ownerWithCompleteIntake(world: TestWorld, tag: string) {
  const owner = await registerVerifiedUser(world, {
    name: `Submit Owner ${tag}`,
    email: `submit-owner-${tag}@example.com`,
    password: PASSWORD,
  });
  const org = await world.services.organizations.create(owner.principal, {
    name: `Submit Org ${tag}`,
    contactEmail: `submit-${tag}@example.com`,
  });
  await world.services.intake.getOrCreateDraft(owner.principal, org.id);
  let revision = 0;
  for (const section of INTAKE_SECTION_IDS) {
    await world.services.intake.saveSection(owner.principal, org.id, section, {
      baseRevision: revision,
      data: COMPLETE_SECTIONS[section] as Record<string, unknown>,
    });
    revision += 1;
  }
  return { owner, org };
}

/** Submits the completed intake and returns the created project id. */
export async function submittedProject(world: TestWorld, tag: string) {
  const { owner, org } = await ownerWithCompleteIntake(world, tag);
  const { projectId } = await world.services.projects.submitIntake(owner.principal, org.id, {
    confirmAccuracy: true,
  });
  return { owner, org, projectId };
}
