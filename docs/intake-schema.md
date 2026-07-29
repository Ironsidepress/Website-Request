# Intake Questionnaire Schema

## Principles

- The intake is a **versioned document**: `schemaVersion` is stored with every draft,
  revision and submission. Schema changes bump the version; old submissions remain
  readable under their original version.
- Runtime validation uses **Zod** schemas shared between client (form validation),
  server (API validation) and workflow (input contract). One source of truth in
  `packages/schemas/src/intake/`.
- **Storage strategy:** the intake payload is stored as a JSON document in D1
  (`intakes.data`), validated on every write. It is not normalized into per-question
  tables — the document is an input artifact to the workflow, not a query surface.
  Fields that need querying (status, schema version, organization) are promoted to
  columns. See ADR-0007 in `docs/architecture-decisions.md`.
- **Autosave** is per-section: `PATCH` carries `{ sectionId, sectionVersion, data }`,
  validated with that section's *draft* schema (all fields optional) and merged.
  Submission validates the whole document with the *strict* schema (required fields,
  cross-field and conditional rules).
- Every autosave appends an `intake_revisions` row (section, diff or full section
  snapshot, actor, timestamp) for recoverability and audit.

## Sections overview

| # | Section id | Title | Conditional on |
| --- | --- | --- | --- |
| 1 | `business` | Business profile | — |
| 2 | `services` | Services & offerings | — |
| 3 | `audiences` | Target audiences | — |
| 4 | `competitors` | Competitors | — |
| 5 | `examples` | Website examples | — |
| 6 | `domain` | Domain | branches internally on `ownsDomain` |
| 7 | `branding` | Branding assets | branches internally on `hasBrandAssets` |
| 8 | `content` | Content availability | branches internally on `contentReadiness` |
| 9 | `functionality` | Website functionality | branches internally on selected features |
| 10 | `review` | Review & submit | all prior sections valid |

## Section schemas (strict/submission form)

TypeScript with Zod, abbreviated for readability. Draft schemas are derived with
`.deepPartial()`-style relaxation plus per-field `max` limits kept strict (never store
oversized input, even in drafts).

### 1. `business`

```ts
const BusinessProfile = z.object({
  legalName: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  description: z.string().min(20).max(2000),        // "what does your business do?"
  yearEstablished: z.number().int().min(1800).max(currentYear).optional(),
  contact: z.object({
    email: z.string().email(),
    phone: z.string().max(30).optional(),
  }),
  address: z.object({
    line1: z.string().max(200), line2: z.string().max(200).optional(),
    city: z.string().max(100), region: z.string().max(100),
    postalCode: z.string().max(20), country: z.string().length(2), // ISO 3166-1
  }).optional(),
  serviceArea: z.enum(['local', 'regional', 'national', 'online_only']),
  hours: z.string().max(500).optional(),
  socialProfiles: z.array(z.object({
    platform: z.enum(['facebook','instagram','linkedin','x','tiktok','youtube','yelp','google_business','other']),
    url: z.string().url(),
  })).max(10).default([]),
});
```

### 2. `services`

```ts
const Services = z.object({
  offerings: z.array(z.object({
    name: z.string().min(1).max(120),
    description: z.string().max(1000),
    isPrimary: z.boolean().default(false),
    priceDisplay: z.enum(['exact','starting_at','range','hide']).default('hide'),
    priceText: z.string().max(100).optional(),      // required iff priceDisplay !== 'hide'
  })).min(1).max(50),
  uniqueSellingPoints: z.array(z.string().max(300)).max(10).default([]),
}).superRefine(requirePriceTextWhenShown);
```

### 3. `audiences`

```ts
const Audiences = z.object({
  primaryAudience: z.object({
    description: z.string().min(10).max(1000),      // who they are
    problems: z.string().max(1000),                 // what they need solved
  }),
  secondaryAudiences: z.array(z.string().max(500)).max(5).default([]),
  tone: z.enum(['professional','friendly','bold','luxury','playful','technical','other']),
  toneOther: z.string().max(200).optional(),        // required iff tone === 'other'
});
```

### 4. `competitors`

```ts
const Competitors = z.object({
  competitors: z.array(z.object({
    name: z.string().min(1).max(200),
    websiteUrl: z.string().url().optional(),
    notes: z.string().max(500).optional(),          // what they do well / poorly
  })).max(10).default([]),
  differentiation: z.string().max(1000).optional(), // how the client stands apart
});
```

### 5. `examples`

```ts
const Examples = z.object({
  likedWebsites: z.array(z.object({
    url: z.string().url(),
    whatTheyLike: z.string().max(500),
  })).max(10).default([]),
  dislikedWebsites: z.array(z.object({
    url: z.string().url(),
    whatTheyDislike: z.string().max(500),
  })).max(10).default([]),
});
```

### 6. `domain` — conditional

```ts
const Domain = z.discriminatedUnion('ownsDomain', [
  z.object({
    ownsDomain: z.literal(true),
    domainName: z.string().max(253).regex(domainRegex),
    registrar: z.string().max(100).optional(),
    hasDnsAccess: z.boolean(),                      // drives later DNS-change approval flow
    email: z.object({ usesDomainEmail: z.boolean(), provider: z.string().max(100).optional() }),
  }),
  z.object({
    ownsDomain: z.literal(false),
    desiredNames: z.array(z.string().max(253)).min(1).max(5),  // ranked suggestions
    tldPreferences: z.array(z.string().max(10)).max(5).default(['.com']),
    purchaseConsent: z.literal(true),               // acknowledges purchase requires their approval
  }),
]);
```

Conditional UI: owning a domain shows registrar/DNS questions; not owning shows the
suggestion list. Domain purchase itself is post-MVP and always human-approved.

### 7. `branding` — conditional

```ts
const Branding = z.discriminatedUnion('hasBrandAssets', [
  z.object({
    hasBrandAssets: z.literal(true),
    assetFileIds: z.array(FileId).min(1).max(30),   // logos, brand guides → files table
    brandColors: z.array(hexColor).max(8).default([]),
    fonts: z.array(z.string().max(100)).max(5).default([]),
    brandGuidelinesNotes: z.string().max(1000).optional(),
  }),
  z.object({
    hasBrandAssets: z.literal(false),
    stylePreferences: z.array(z.enum(['minimal','classic','modern','warm','corporate','organic','bold'])).min(1).max(3),
    colorPreferences: z.string().max(500).optional(),
    avoidList: z.string().max(500).optional(),      // "nothing like…"
    needsLogoDesign: z.boolean(),
  }),
]);
```

`FileId` references a `files` row that must belong to the same organization and
intake — enforced server-side, never trusted from the client.

### 8. `content` — conditional

```ts
const Content = z.object({
  contentReadiness: z.enum(['have_everything','have_some','need_creation']),
  copyFileIds: z.array(FileId).max(30).default([]),     // required-nonempty iff 'have_everything'
  photoFileIds: z.array(FileId).max(100).default([]),
  needsCopywriting: z.boolean(),                        // forced true iff 'need_creation'
  needsPhotography: z.enum(['none','stock_ok','professional_needed']),
  existingContentUrls: z.array(z.string().url()).max(10).default([]),  // e.g. GBP, socials
  factsToVerify: z.array(z.string().max(300)).max(20).default([]),
  // ^ claims like "voted best plumber 2024" — feed the unverified-claims approval gate
}).superRefine(contentCrossRules);
```

### 9. `functionality`

```ts
const Functionality = z.object({
  features: z.array(z.enum([
    'contact_form','click_to_call','appointment_booking','quote_request',
    'ecommerce','menu_display','gallery','testimonials','blog','faq',
    'service_area_map','multilingual','file_downloads','newsletter_signup',
  ])).min(1),
  bookingProvider: z.string().max(100).optional(),      // shown iff appointment_booking
  ecommerce: z.object({                                  // shown iff ecommerce
    approxProductCount: z.number().int().min(1).max(10000),
    needsPayments: z.boolean(),
  }).optional(),
  pageExpectations: z.enum(['one_page','up_to_5','up_to_10','not_sure']),
  integrations: z.array(z.string().max(100)).max(10).default([]),
  accessibilityNotes: z.string().max(500).optional(),
}).superRefine(featureDependentRules);
```

### 10. `review`

No new data. Submission requires: every visible (non-skipped-by-condition) section
valid under strict schema; at least one of `services.offerings`; consent checkbox
(`clientConfirmsAccuracy: literal(true)`) — this is the client's attestation used later
by the factual-claims gate.

## Document envelope

```ts
const IntakeDocument = z.object({
  schemaVersion: z.literal(1),
  business: BusinessProfile,
  services: Services,
  audiences: Audiences,
  competitors: Competitors,
  examples: Examples,
  domain: Domain,
  branding: Branding,
  content: Content,
  functionality: Functionality,
  clientConfirmsAccuracy: z.literal(true),
});
```

## Autosave API contract

- `POST /api/intakes` → creates draft (one active draft per organization).
- `GET  /api/intakes/:id` → current draft + per-section validity map.
- `PATCH /api/intakes/:id/sections/:sectionId` → body `{ baseRevision, data }`.
  - Validated with the draft schema for that section.
  - Optimistic concurrency: stale `baseRevision` returns 409 with the current
    section state (last-write-wins is not acceptable for multi-tab editing).
  - Appends `intake_revisions` row; returns new revision number.
- `POST /api/intakes/:id/submit` → strict validation; on success sets
  `status=submitted`, freezes the document, creates project, starts workflow.

## Versioning rules

1. Additive optional fields: same major version, bump minor in `packages/schemas`.
2. Any required-field, rename or conditional-logic change: new `schemaVersion`,
   with a migration note; drafts in flight are upgraded by an explicit migration
   function or completed under their original version.
3. The workflow records the intake `schemaVersion` it consumed
   (input artifact version in `agent_runs`).
