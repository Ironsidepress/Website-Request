import { z } from 'zod';

import {
  audiencesSchema,
  brandingSchema,
  businessProfileSchema,
  competitorsSchema,
  contentSchema,
  domainSchema,
  examplesSchema,
  functionalitySchema,
  servicesSchema,
} from './sections';

export const INTAKE_SCHEMA_VERSION = 1;

/**
 * The nine data sections. "review" is not a data section — it is the strict
 * validation of every section plus the accuracy attestation at submission.
 */
export const INTAKE_SECTION_IDS = [
  'business',
  'services',
  'audiences',
  'competitors',
  'examples',
  'domain',
  'branding',
  'content',
  'functionality',
] as const;

export type IntakeSectionId = (typeof INTAKE_SECTION_IDS)[number];

export const intakeSectionSchemas = {
  business: businessProfileSchema,
  services: servicesSchema,
  audiences: audiencesSchema,
  competitors: competitorsSchema,
  examples: examplesSchema,
  domain: domainSchema,
  branding: brandingSchema,
  content: contentSchema,
  functionality: functionalitySchema,
} as const satisfies Record<IntakeSectionId, z.ZodType>;

export const intakeSectionIdSchema = z.enum(INTAKE_SECTION_IDS);

/** Full document, validated at submission (M4). */
export const intakeDocumentSchema = z.object({
  schemaVersion: z.literal(INTAKE_SCHEMA_VERSION),
  business: businessProfileSchema,
  services: servicesSchema,
  audiences: audiencesSchema,
  competitors: competitorsSchema,
  examples: examplesSchema,
  domain: domainSchema,
  branding: brandingSchema,
  content: contentSchema,
  functionality: functionalitySchema,
  /** Client attestation used by the factual-claims gate. */
  clientConfirmsAccuracy: z.literal(true),
});

export type IntakeDocument = z.infer<typeof intakeDocumentSchema>;

export interface SectionValidity {
  valid: boolean;
  /** Safe, human-readable issue summaries (path + message only). */
  issues: Array<{ path: string; message: string }>;
  /** False when the section has never been touched. */
  started: boolean;
}

export type IntakeValidityMap = Record<IntakeSectionId, SectionValidity>;

/**
 * Validates each section of a draft document against the STRICT schema and
 * returns the validity map the wizard renders. Draft storage itself accepts
 * bounded partial data (see draft.ts) — this is the feedback layer.
 */
export function computeIntakeValidity(draftData: Record<string, unknown>): IntakeValidityMap {
  const entries = INTAKE_SECTION_IDS.map((sectionId) => {
    const value = draftData[sectionId];
    if (value === undefined || value === null) {
      return [
        sectionId,
        { valid: false, started: false, issues: [{ path: '', message: 'Not started' }] },
      ] as const;
    }
    const result = intakeSectionSchemas[sectionId].safeParse(value);
    return [
      sectionId,
      {
        valid: result.success,
        started: true,
        issues: result.success
          ? []
          : result.error.issues.map((issue) => ({
              path: issue.path.map(String).join('.'),
              message: issue.message,
            })),
      },
    ] as const;
  });
  return Object.fromEntries(entries) as IntakeValidityMap;
}
