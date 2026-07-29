import { describe, expect, it } from 'vitest';

import { computeIntakeValidity, intakeDocumentSchema, INTAKE_SCHEMA_VERSION } from './document';
import { MAX_SECTION_BYTES, saveSectionInputSchema, sectionDraftSchema } from './draft';
import {
  audiencesSchema,
  brandingSchema,
  contentSchema,
  domainSchema,
  functionalitySchema,
  servicesSchema,
} from './sections';

export const validBusiness = {
  legalName: 'Ironside Press LLC',
  displayName: 'Ironside Press',
  description: 'A letterpress print shop for small businesses and event stationery.',
  contact: { email: 'hello@ironsidepress.net' },
  serviceArea: 'local',
};

export const validServices = {
  offerings: [{ name: 'Wedding invitations', description: 'Custom letterpress suites' }],
};

const validAudiences = {
  primaryAudience: {
    description: 'Engaged couples planning weddings',
    problems: 'Need memorable stationery',
  },
  tone: 'friendly',
};

const validDomainOwned = {
  ownsDomain: true,
  domainName: 'ironsidepress.net',
  hasDnsAccess: true,
  email: { usesDomainEmail: true, provider: 'Google Workspace' },
};

const validDomainWanted = {
  ownsDomain: false,
  desiredNames: ['ironsidepress.com'],
  purchaseConsent: true,
};

const validBrandingNoAssets = {
  hasBrandAssets: false,
  stylePreferences: ['classic'],
  needsLogoDesign: false,
};

const validContent = {
  contentReadiness: 'need_creation',
  needsCopywriting: true,
  needsPhotography: 'stock_ok',
};

const validFunctionality = {
  features: ['contact_form', 'gallery'],
  pageExpectations: 'up_to_5',
};

describe('conditional sections', () => {
  it('domain: owning branch requires domain details, wanting branch requires suggestions', () => {
    expect(domainSchema.safeParse(validDomainOwned).success).toBe(true);
    expect(domainSchema.safeParse(validDomainWanted).success).toBe(true);
    expect(domainSchema.safeParse({ ownsDomain: true }).success).toBe(false);
    expect(domainSchema.safeParse({ ownsDomain: false, desiredNames: [] }).success).toBe(false);
    // The hidden branch's fields are never required across branches.
    expect(
      domainSchema.safeParse({ ...validDomainWanted, registrar: 'should-not-matter' }).success,
    ).toBe(true);
  });

  it('branding: asset branch requires uploads, no-asset branch requires style preferences', () => {
    expect(brandingSchema.safeParse(validBrandingNoAssets).success).toBe(true);
    expect(brandingSchema.safeParse({ hasBrandAssets: true, assetFileIds: [] }).success).toBe(
      false,
    );
    expect(
      brandingSchema.safeParse({
        hasBrandAssets: true,
        assetFileIds: ['0198e0a2-7b7a-7ccc-8f6c-111111111111'],
      }).success,
    ).toBe(true);
    expect(brandingSchema.safeParse({ hasBrandAssets: false, stylePreferences: [] }).success).toBe(
      false,
    );
  });

  it('content: cross-field rules for readiness answers', () => {
    expect(contentSchema.safeParse(validContent).success).toBe(true);
    expect(
      contentSchema.safeParse({ ...validContent, contentReadiness: 'have_everything' }).success,
    ).toBe(false);
    expect(contentSchema.safeParse({ ...validContent, needsCopywriting: false }).success).toBe(
      false,
    );
  });

  it('functionality: ecommerce feature requires ecommerce details', () => {
    expect(functionalitySchema.safeParse(validFunctionality).success).toBe(true);
    expect(
      functionalitySchema.safeParse({ ...validFunctionality, features: ['ecommerce'] }).success,
    ).toBe(false);
    expect(
      functionalitySchema.safeParse({
        ...validFunctionality,
        features: ['ecommerce'],
        ecommerce: { approxProductCount: 12, needsPayments: true },
      }).success,
    ).toBe(true);
  });

  it('services: shown prices require price text; audiences: "other" tone requires description', () => {
    const priced = {
      offerings: [
        { name: 'Posters', description: '', priceDisplay: 'starting_at', priceText: 'from $40' },
      ],
    };
    expect(servicesSchema.safeParse(priced).success).toBe(true);
    const missing = { offerings: [{ name: 'Posters', description: '', priceDisplay: 'exact' }] };
    expect(servicesSchema.safeParse(missing).success).toBe(false);
    expect(audiencesSchema.safeParse({ ...validAudiences, tone: 'other' }).success).toBe(false);
    expect(
      audiencesSchema.safeParse({ ...validAudiences, tone: 'other', toneOther: 'Dry humor' })
        .success,
    ).toBe(true);
  });
});

describe('full document', () => {
  it('accepts a complete, consistent document with attestation', () => {
    const document = {
      schemaVersion: INTAKE_SCHEMA_VERSION,
      business: validBusiness,
      services: validServices,
      audiences: validAudiences,
      competitors: {},
      examples: {},
      domain: validDomainWanted,
      branding: validBrandingNoAssets,
      content: validContent,
      functionality: validFunctionality,
      clientConfirmsAccuracy: true,
    };
    const result = intakeDocumentSchema.safeParse(document);
    expect(result.success, JSON.stringify(result.success ? '' : result.error.issues)).toBe(true);
  });

  it('rejects a document without the accuracy attestation', () => {
    const result = intakeDocumentSchema.safeParse({
      schemaVersion: INTAKE_SCHEMA_VERSION,
      business: validBusiness,
      services: validServices,
      audiences: validAudiences,
      competitors: {},
      examples: {},
      domain: validDomainWanted,
      branding: validBrandingNoAssets,
      content: validContent,
      functionality: validFunctionality,
      clientConfirmsAccuracy: false,
    });
    expect(result.success).toBe(false);
  });
});

describe('validity map', () => {
  it('reports untouched, invalid and valid sections distinctly', () => {
    const validity = computeIntakeValidity({
      business: validBusiness,
      services: { offerings: [] },
    });
    expect(validity.business).toMatchObject({ valid: true, started: true });
    expect(validity.services).toMatchObject({ valid: false, started: true });
    expect(validity.services.issues.length).toBeGreaterThan(0);
    expect(validity.domain).toMatchObject({ valid: false, started: false });
  });
});

describe('draft guard', () => {
  it('accepts partial, half-typed section data', () => {
    expect(
      sectionDraftSchema.safeParse({ legalName: 'Iron', contact: { email: 'not-y' } }).success,
    ).toBe(true);
  });

  it('rejects oversized drafts', () => {
    const big = { note: 'x'.repeat(MAX_SECTION_BYTES + 1) };
    expect(sectionDraftSchema.safeParse(big).success).toBe(false);
  });

  it('rejects overly deep nesting and giant arrays', () => {
    let nested: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 12; i += 1) nested = { child: nested };
    expect(sectionDraftSchema.safeParse(nested).success).toBe(false);
    expect(
      sectionDraftSchema.safeParse({ list: Array.from({ length: 500 }, (_, i) => i) }).success,
    ).toBe(false);
  });

  it('save input requires a non-negative base revision', () => {
    expect(saveSectionInputSchema.safeParse({ baseRevision: 0, data: {} }).success).toBe(true);
    expect(saveSectionInputSchema.safeParse({ baseRevision: -1, data: {} }).success).toBe(false);
  });
});
