import { z } from 'zod';

/**
 * Intake questionnaire section schemas, v1 (docs/intake-schema.md).
 *
 * These are the STRICT schemas used at submission and for the per-section
 * validity map shown while drafting. Draft autosave input is guarded
 * separately (see draft.ts) — bounded JSON is accepted so clients can save
 * half-typed answers, while validity is always reported against these.
 */

const shortText = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => z.string().trim().min(1).max(max);

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const DOMAIN_NAME =
  /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;

/** File references point at `files` rows; ownership is enforced server-side (M3). */
export const fileIdSchema = z.uuid();

// ---------------------------------------------------------------- 1. business

export const businessProfileSchema = z.object({
  legalName: requiredText(200),
  displayName: requiredText(200),
  description: z.string().trim().min(20).max(2000),
  yearEstablished: z.number().int().min(1800).max(new Date().getFullYear()).optional(),
  contact: z.object({
    email: z.email().max(254),
    phone: shortText(30).optional(),
  }),
  address: z
    .object({
      line1: requiredText(200),
      line2: shortText(200).optional(),
      city: requiredText(100),
      region: requiredText(100),
      postalCode: requiredText(20),
      country: z.string().length(2),
    })
    .optional(),
  serviceArea: z.enum(['local', 'regional', 'national', 'online_only']),
  hours: shortText(500).optional(),
  socialProfiles: z
    .array(
      z.object({
        platform: z.enum([
          'facebook',
          'instagram',
          'linkedin',
          'x',
          'tiktok',
          'youtube',
          'yelp',
          'google_business',
          'other',
        ]),
        url: z.url({ protocol: /^https?$/ }),
      }),
    )
    .max(10)
    .default([]),
});

// ---------------------------------------------------------------- 2. services

export const servicesSchema = z
  .object({
    offerings: z
      .array(
        z.object({
          name: requiredText(120),
          description: shortText(1000),
          isPrimary: z.boolean().default(false),
          priceDisplay: z.enum(['exact', 'starting_at', 'range', 'hide']).default('hide'),
          priceText: shortText(100).optional(),
        }),
      )
      .min(1)
      .max(50),
    uniqueSellingPoints: z.array(shortText(300)).max(10).default([]),
  })
  .superRefine((value, ctx) => {
    value.offerings.forEach((offering, index) => {
      if (offering.priceDisplay !== 'hide' && !offering.priceText?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['offerings', index, 'priceText'],
          message: 'Provide the price text to display, or set price display to "hide"',
        });
      }
    });
  });

// --------------------------------------------------------------- 3. audiences

export const audiencesSchema = z
  .object({
    primaryAudience: z.object({
      description: z.string().trim().min(10).max(1000),
      problems: shortText(1000),
    }),
    secondaryAudiences: z.array(shortText(500)).max(5).default([]),
    tone: z.enum(['professional', 'friendly', 'bold', 'luxury', 'playful', 'technical', 'other']),
    toneOther: shortText(200).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.tone === 'other' && !value.toneOther?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['toneOther'],
        message: 'Describe the tone you have in mind',
      });
    }
  });

// -------------------------------------------------------------- 4. competitors

export const competitorsSchema = z.object({
  competitors: z
    .array(
      z.object({
        name: requiredText(200),
        websiteUrl: z.url({ protocol: /^https?$/ }).optional(),
        notes: shortText(500).optional(),
      }),
    )
    .max(10)
    .default([]),
  differentiation: shortText(1000).optional(),
});

// ---------------------------------------------------------------- 5. examples

export const examplesSchema = z.object({
  likedWebsites: z
    .array(
      z.object({
        url: z.url({ protocol: /^https?$/ }),
        whatTheyLike: shortText(500),
      }),
    )
    .max(10)
    .default([]),
  dislikedWebsites: z
    .array(
      z.object({
        url: z.url({ protocol: /^https?$/ }),
        whatTheyDislike: shortText(500),
      }),
    )
    .max(10)
    .default([]),
});

// ------------------------------------------------------ 6. domain (conditional)

export const domainSchema = z.discriminatedUnion('ownsDomain', [
  z.object({
    ownsDomain: z.literal(true),
    domainName: z.string().trim().regex(DOMAIN_NAME, 'Enter a valid domain name'),
    registrar: shortText(100).optional(),
    hasDnsAccess: z.boolean(),
    email: z.object({
      usesDomainEmail: z.boolean(),
      provider: shortText(100).optional(),
    }),
  }),
  z.object({
    ownsDomain: z.literal(false),
    desiredNames: z
      .array(z.string().trim().regex(DOMAIN_NAME, 'Enter a valid domain name'))
      .min(1)
      .max(5),
    tldPreferences: z.array(shortText(10)).max(5).default(['.com']),
    /** Acknowledges any purchase happens only after their explicit approval. */
    purchaseConsent: z.literal(true),
  }),
]);

// ---------------------------------------------------- 7. branding (conditional)

export const brandingSchema = z.discriminatedUnion('hasBrandAssets', [
  z.object({
    hasBrandAssets: z.literal(true),
    assetFileIds: z.array(fileIdSchema).min(1).max(30),
    brandColors: z.array(z.string().regex(HEX_COLOR)).max(8).default([]),
    fonts: z.array(shortText(100)).max(5).default([]),
    brandGuidelinesNotes: shortText(1000).optional(),
  }),
  z.object({
    hasBrandAssets: z.literal(false),
    stylePreferences: z
      .array(z.enum(['minimal', 'classic', 'modern', 'warm', 'corporate', 'organic', 'bold']))
      .min(1)
      .max(3),
    colorPreferences: shortText(500).optional(),
    avoidList: shortText(500).optional(),
    needsLogoDesign: z.boolean(),
  }),
]);

// ----------------------------------------------------- 8. content (conditional)

export const contentSchema = z
  .object({
    contentReadiness: z.enum(['have_everything', 'have_some', 'need_creation']),
    copyFileIds: z.array(fileIdSchema).max(30).default([]),
    photoFileIds: z.array(fileIdSchema).max(100).default([]),
    needsCopywriting: z.boolean(),
    needsPhotography: z.enum(['none', 'stock_ok', 'professional_needed']),
    existingContentUrls: z
      .array(z.url({ protocol: /^https?$/ }))
      .max(10)
      .default([]),
    /** Claims like "voted best plumber 2024" — feed the factual-claims gate. */
    factsToVerify: z.array(shortText(300)).max(20).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.contentReadiness === 'have_everything' && value.copyFileIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['copyFileIds'],
        message: 'Upload your copy documents, or change your content readiness answer',
      });
    }
    if (value.contentReadiness === 'need_creation' && !value.needsCopywriting) {
      ctx.addIssue({
        code: 'custom',
        path: ['needsCopywriting'],
        message: 'Content creation was requested, so copywriting must be included',
      });
    }
  });

// ------------------------------------------------ 9. functionality (conditional)

export const WEBSITE_FEATURES = [
  'contact_form',
  'click_to_call',
  'appointment_booking',
  'quote_request',
  'ecommerce',
  'menu_display',
  'gallery',
  'testimonials',
  'blog',
  'faq',
  'service_area_map',
  'multilingual',
  'file_downloads',
  'newsletter_signup',
] as const;

export const functionalitySchema = z
  .object({
    features: z.array(z.enum(WEBSITE_FEATURES)).min(1),
    bookingProvider: shortText(100).optional(),
    ecommerce: z
      .object({
        approxProductCount: z.number().int().min(1).max(10000),
        needsPayments: z.boolean(),
      })
      .optional(),
    pageExpectations: z.enum(['one_page', 'up_to_5', 'up_to_10', 'not_sure']),
    integrations: z.array(shortText(100)).max(10).default([]),
    accessibilityNotes: shortText(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.features.includes('ecommerce') && !value.ecommerce) {
      ctx.addIssue({
        code: 'custom',
        path: ['ecommerce'],
        message: 'Tell us roughly how many products you sell',
      });
    }
  });
