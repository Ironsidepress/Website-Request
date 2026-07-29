'use client';

import { WEBSITE_FEATURES } from '@website-factory/schemas';

import { FileUploadField } from './file-upload';
import {
  CheckboxField,
  FieldGroup,
  RadioChoice,
  SelectField,
  StringListField,
  TextArea,
  TextField,
} from './fields';

/**
 * Per-section forms. Each receives that section's draft value (arbitrary
 * partial JSON) and an onChange that replaces it; the page owns autosave.
 */
// Draft section data is intentionally untyped partial JSON — users save
// half-typed answers, and strict validation happens continuously via the
// validity map rather than at the form boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DraftValue = any;
type SectionProps = {
  value: DraftValue;
  onChange: (value: DraftValue) => void;
  organizationId: string;
};

const set = (value: Record<string, unknown>, patch: Record<string, unknown>) => ({
  ...value,
  ...patch,
});

export function BusinessSection({ value = {}, onChange }: SectionProps) {
  return (
    <>
      <TextField
        label="Legal business name"
        value={value.legalName}
        maxLength={200}
        onChange={(v) => onChange(set(value, { legalName: v }))}
      />
      <TextField
        label="Display name"
        value={value.displayName}
        maxLength={200}
        onChange={(v) => onChange(set(value, { displayName: v }))}
      />
      <TextArea
        label="What does your business do? (at least 20 characters)"
        value={value.description}
        onChange={(v) => onChange(set(value, { description: v }))}
      />
      <TextField
        label="Contact email"
        type="email"
        value={value.contact?.email}
        maxLength={254}
        onChange={(v) => onChange(set(value, { contact: { ...value.contact, email: v } }))}
      />
      <TextField
        label="Contact phone (optional)"
        value={value.contact?.phone}
        maxLength={30}
        onChange={(v) => onChange(set(value, { contact: { ...value.contact, phone: v } }))}
      />
      <SelectField
        label="Where do you serve customers?"
        value={value.serviceArea}
        options={[
          { value: 'local', label: 'Locally' },
          { value: 'regional', label: 'Regionally' },
          { value: 'national', label: 'Nationally' },
          { value: 'online_only', label: 'Online only' },
        ]}
        onChange={(v) => onChange(set(value, { serviceArea: v }))}
      />
      <TextArea
        label="Business hours (optional)"
        value={value.hours}
        maxLength={500}
        onChange={(v) => onChange(set(value, { hours: v }))}
      />
    </>
  );
}

export function ServicesSection({ value = {}, onChange }: SectionProps) {
  const offerings: Array<Record<string, unknown>> = value.offerings ?? [];
  const updateOffering = (index: number, patch: Record<string, unknown>) => {
    const next = offerings.map((o, i) => (i === index ? { ...o, ...patch } : o));
    onChange(set(value, { offerings: next }));
  };
  return (
    <>
      <p>List the services or products you want the website to feature (at least one).</p>
      {offerings.map((offering, index) => (
        <fieldset key={index}>
          <legend>Offering {index + 1}</legend>
          <TextField
            label="Name"
            value={offering.name as string}
            maxLength={120}
            onChange={(v) => updateOffering(index, { name: v })}
          />
          <TextArea
            label="Description"
            value={offering.description as string}
            maxLength={1000}
            onChange={(v) => updateOffering(index, { description: v })}
          />
          <CheckboxField
            label="This is a primary offering"
            checked={offering.isPrimary as boolean}
            onChange={(v) => updateOffering(index, { isPrimary: v })}
          />
          <SelectField
            label="Price display"
            value={(offering.priceDisplay as string) ?? 'hide'}
            options={[
              { value: 'hide', label: 'Do not show prices' },
              { value: 'exact', label: 'Exact price' },
              { value: 'starting_at', label: 'Starting at…' },
              { value: 'range', label: 'Price range' },
            ]}
            onChange={(v) => updateOffering(index, { priceDisplay: v })}
          />
          {offering.priceDisplay && offering.priceDisplay !== 'hide' ? (
            <TextField
              label="Price text to display"
              value={offering.priceText as string}
              maxLength={100}
              onChange={(v) => updateOffering(index, { priceText: v })}
            />
          ) : null}
          <button
            type="button"
            onClick={() =>
              onChange(set(value, { offerings: offerings.filter((_, i) => i !== index) }))
            }
          >
            Remove offering
          </button>
        </fieldset>
      ))}
      {offerings.length < 50 ? (
        <button
          type="button"
          onClick={() =>
            onChange(set(value, { offerings: [...offerings, { name: '', description: '' }] }))
          }
        >
          Add offering
        </button>
      ) : null}
      <StringListField
        label="What makes you different? (unique selling points)"
        values={value.uniqueSellingPoints}
        max={10}
        onChange={(v) => onChange(set(value, { uniqueSellingPoints: v }))}
      />
    </>
  );
}

export function AudiencesSection({ value = {}, onChange }: SectionProps) {
  return (
    <>
      <TextArea
        label="Who is your primary audience? (at least 10 characters)"
        value={value.primaryAudience?.description}
        onChange={(v) =>
          onChange(set(value, { primaryAudience: { ...value.primaryAudience, description: v } }))
        }
      />
      <TextArea
        label="What problems do they need solved?"
        value={value.primaryAudience?.problems}
        maxLength={1000}
        onChange={(v) =>
          onChange(set(value, { primaryAudience: { ...value.primaryAudience, problems: v } }))
        }
      />
      <StringListField
        label="Secondary audiences (optional)"
        values={value.secondaryAudiences}
        max={5}
        onChange={(v) => onChange(set(value, { secondaryAudiences: v }))}
      />
      <SelectField
        label="Tone of voice"
        value={value.tone}
        options={[
          'professional',
          'friendly',
          'bold',
          'luxury',
          'playful',
          'technical',
          'other',
        ].map((tone) => ({ value: tone, label: tone }))}
        onChange={(v) => onChange(set(value, { tone: v }))}
      />
      {value.tone === 'other' ? (
        <TextField
          label="Describe the tone"
          value={value.toneOther}
          maxLength={200}
          onChange={(v) => onChange(set(value, { toneOther: v }))}
        />
      ) : null}
    </>
  );
}

export function CompetitorsSection({ value = {}, onChange }: SectionProps) {
  const competitors: Array<Record<string, unknown>> = value.competitors ?? [];
  const update = (index: number, patch: Record<string, unknown>) =>
    onChange(
      set(value, {
        competitors: competitors.map((c, i) => (i === index ? { ...c, ...patch } : c)),
      }),
    );
  return (
    <>
      {competitors.map((competitor, index) => (
        <fieldset key={index}>
          <legend>Competitor {index + 1}</legend>
          <TextField
            label="Name"
            value={competitor.name as string}
            maxLength={200}
            onChange={(v) => update(index, { name: v })}
          />
          <TextField
            label="Website (optional)"
            value={competitor.websiteUrl as string}
            maxLength={500}
            onChange={(v) => update(index, { websiteUrl: v || undefined })}
          />
          <TextArea
            label="What do they do well or poorly? (optional)"
            value={competitor.notes as string}
            maxLength={500}
            onChange={(v) => update(index, { notes: v })}
          />
          <button
            type="button"
            onClick={() =>
              onChange(set(value, { competitors: competitors.filter((_, i) => i !== index) }))
            }
          >
            Remove
          </button>
        </fieldset>
      ))}
      {competitors.length < 10 ? (
        <button
          type="button"
          onClick={() => onChange(set(value, { competitors: [...competitors, { name: '' }] }))}
        >
          Add competitor
        </button>
      ) : null}
      <TextArea
        label="How do you stand apart? (optional)"
        value={value.differentiation}
        maxLength={1000}
        onChange={(v) => onChange(set(value, { differentiation: v }))}
      />
    </>
  );
}

function WebsiteListEditor(props: {
  label: string;
  noteLabel: string;
  entries: Array<Record<string, unknown>> | undefined;
  noteKey: string;
  onChange: (entries: Array<Record<string, unknown>>) => void;
}) {
  const entries = props.entries ?? [];
  return (
    <FieldGroup label={props.label}>
      {entries.map((entry, index) => (
        <fieldset key={index}>
          <TextField
            label="URL"
            value={entry.url as string}
            maxLength={500}
            onChange={(v) =>
              props.onChange(entries.map((e, i) => (i === index ? { ...e, url: v } : e)))
            }
          />
          <TextArea
            label={props.noteLabel}
            value={entry[props.noteKey] as string}
            maxLength={500}
            onChange={(v) =>
              props.onChange(
                entries.map((e, i) => (i === index ? { ...e, [props.noteKey]: v } : e)),
              )
            }
          />
          <button
            type="button"
            onClick={() => props.onChange(entries.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </fieldset>
      ))}
      {entries.length < 10 ? (
        <button type="button" onClick={() => props.onChange([...entries, { url: '' }])}>
          Add website
        </button>
      ) : null}
    </FieldGroup>
  );
}

export function ExamplesSection({ value = {}, onChange }: SectionProps) {
  return (
    <>
      <WebsiteListEditor
        label="Websites you like"
        noteLabel="What do you like about it?"
        noteKey="whatTheyLike"
        entries={value.likedWebsites}
        onChange={(entries) => onChange(set(value, { likedWebsites: entries }))}
      />
      <WebsiteListEditor
        label="Websites you dislike"
        noteLabel="What do you dislike about it?"
        noteKey="whatTheyDislike"
        entries={value.dislikedWebsites}
        onChange={(entries) => onChange(set(value, { dislikedWebsites: entries }))}
      />
    </>
  );
}

export function DomainSection({ value = {}, onChange }: SectionProps) {
  return (
    <>
      <RadioChoice
        label="Do you already own a domain name?"
        name="ownsDomain"
        value={value.ownsDomain}
        yesLabel="Yes, I own one"
        noLabel="No, I need one"
        onChange={(owns) => onChange({ ownsDomain: owns })}
      />
      {value.ownsDomain === true ? (
        <>
          <TextField
            label="Your domain name"
            value={value.domainName}
            maxLength={253}
            onChange={(v) => onChange(set(value, { domainName: v }))}
          />
          <TextField
            label="Registrar (optional)"
            value={value.registrar}
            maxLength={100}
            onChange={(v) => onChange(set(value, { registrar: v }))}
          />
          <RadioChoice
            label="Can you access its DNS settings?"
            name="hasDnsAccess"
            value={value.hasDnsAccess}
            yesLabel="Yes"
            noLabel="No / not sure"
            onChange={(v) => onChange(set(value, { hasDnsAccess: v }))}
          />
          <RadioChoice
            label="Do you use email at this domain?"
            name="usesDomainEmail"
            value={value.email?.usesDomainEmail}
            yesLabel="Yes"
            noLabel="No"
            onChange={(v) =>
              onChange(set(value, { email: { ...value.email, usesDomainEmail: v } }))
            }
          />
          {value.email?.usesDomainEmail ? (
            <TextField
              label="Email provider (optional)"
              value={value.email?.provider}
              maxLength={100}
              onChange={(v) => onChange(set(value, { email: { ...value.email, provider: v } }))}
            />
          ) : null}
        </>
      ) : null}
      {value.ownsDomain === false ? (
        <>
          <StringListField
            label="Domain names you would like (ranked, 1–5)"
            values={value.desiredNames}
            max={5}
            placeholder="example.com"
            onChange={(v) => onChange(set(value, { desiredNames: v }))}
          />
          <CheckboxField
            label="I understand any domain purchase happens only after my explicit approval"
            checked={value.purchaseConsent}
            onChange={(v) => onChange(set(value, { purchaseConsent: v || undefined }))}
          />
        </>
      ) : null}
    </>
  );
}

export function BrandingSection({ value = {}, onChange, organizationId }: SectionProps) {
  return (
    <>
      <RadioChoice
        label="Do you have brand assets (logo, brand guide)?"
        name="hasBrandAssets"
        value={value.hasBrandAssets}
        yesLabel="Yes"
        noLabel="No, start fresh"
        onChange={(has) => onChange({ hasBrandAssets: has })}
      />
      {value.hasBrandAssets === true ? (
        <>
          <FileUploadField
            label="Your logo and brand files (at least one)"
            organizationId={organizationId}
            purpose="brand_guide"
            accept="image/*,.pdf,.doc,.docx"
            value={value.assetFileIds}
            max={30}
            onChange={(ids) => onChange(set(value, { assetFileIds: ids }))}
          />
          <StringListField
            label="Brand colors (hex, e.g. #1a2b3c)"
            values={value.brandColors}
            max={8}
            placeholder="#1a2b3c"
            onChange={(v) => onChange(set(value, { brandColors: v }))}
          />
          <StringListField
            label="Fonts (optional)"
            values={value.fonts}
            max={5}
            onChange={(v) => onChange(set(value, { fonts: v }))}
          />
          <TextArea
            label="Notes about your brand guidelines (optional)"
            value={value.brandGuidelinesNotes}
            maxLength={1000}
            onChange={(v) => onChange(set(value, { brandGuidelinesNotes: v }))}
          />
        </>
      ) : null}
      {value.hasBrandAssets === false ? (
        <>
          <FieldGroup label="Style preferences (choose 1–3)">
            {['minimal', 'classic', 'modern', 'warm', 'corporate', 'organic', 'bold'].map(
              (style) => {
                const selected: string[] = value.stylePreferences ?? [];
                const checked = selected.includes(style);
                return (
                  <label key={style} style={{ marginRight: '1rem' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        onChange(
                          set(value, {
                            stylePreferences: checked
                              ? selected.filter((s) => s !== style)
                              : [...selected, style],
                          }),
                        )
                      }
                    />{' '}
                    {style}
                  </label>
                );
              },
            )}
          </FieldGroup>
          <TextArea
            label="Color preferences (optional)"
            value={value.colorPreferences}
            maxLength={500}
            onChange={(v) => onChange(set(value, { colorPreferences: v }))}
          />
          <TextArea
            label="Anything to avoid? (optional)"
            value={value.avoidList}
            maxLength={500}
            onChange={(v) => onChange(set(value, { avoidList: v }))}
          />
          <RadioChoice
            label="Do you need a logo designed?"
            name="needsLogoDesign"
            value={value.needsLogoDesign}
            yesLabel="Yes"
            noLabel="No"
            onChange={(v) => onChange(set(value, { needsLogoDesign: v }))}
          />
        </>
      ) : null}
    </>
  );
}

export function ContentSection({ value = {}, onChange, organizationId }: SectionProps) {
  return (
    <>
      <SelectField
        label="How ready is your website content (text, photos)?"
        value={value.contentReadiness}
        options={[
          { value: 'have_everything', label: 'I have everything ready' },
          { value: 'have_some', label: 'I have some of it' },
          { value: 'need_creation', label: 'I need it created for me' },
        ]}
        onChange={(v) =>
          onChange(
            set(value, {
              contentReadiness: v,
              ...(v === 'need_creation' ? { needsCopywriting: true } : {}),
            }),
          )
        }
      />
      {value.contentReadiness === 'have_everything' || value.contentReadiness === 'have_some' ? (
        <>
          <FileUploadField
            label="Your website copy (documents)"
            organizationId={organizationId}
            purpose="copy_document"
            accept=".pdf,.doc,.docx,.txt,.md"
            value={value.copyFileIds}
            max={30}
            onChange={(ids) => onChange(set(value, { copyFileIds: ids }))}
          />
          <FileUploadField
            label="Your photos"
            organizationId={organizationId}
            purpose="photo"
            accept="image/*"
            value={value.photoFileIds}
            max={100}
            onChange={(ids) => onChange(set(value, { photoFileIds: ids }))}
          />
        </>
      ) : null}
      {value.contentReadiness !== 'need_creation' ? (
        <CheckboxField
          label="I would like help with copywriting"
          checked={value.needsCopywriting}
          onChange={(v) => onChange(set(value, { needsCopywriting: v }))}
        />
      ) : (
        <p>Copywriting is included when content is created for you.</p>
      )}
      <SelectField
        label="Photography"
        value={value.needsPhotography}
        options={[
          { value: 'none', label: 'I have my own photos' },
          { value: 'stock_ok', label: 'Stock photos are fine' },
          { value: 'professional_needed', label: 'I need professional photography' },
        ]}
        onChange={(v) => onChange(set(value, { needsPhotography: v }))}
      />
      <StringListField
        label="Existing content online (Google Business Profile, socials…)"
        values={value.existingContentUrls}
        max={10}
        placeholder="https://…"
        onChange={(v) => onChange(set(value, { existingContentUrls: v }))}
      />
      <StringListField
        label='Factual claims to verify (awards, "voted best…", statistics)'
        values={value.factsToVerify}
        max={20}
        onChange={(v) => onChange(set(value, { factsToVerify: v }))}
      />
    </>
  );
}

export function FunctionalitySection({ value = {}, onChange }: SectionProps) {
  const features: string[] = value.features ?? [];
  const toggle = (feature: string) =>
    onChange(
      set(value, {
        features: features.includes(feature)
          ? features.filter((f) => f !== feature)
          : [...features, feature],
      }),
    );
  return (
    <>
      <FieldGroup label="Which features does your website need? (choose at least one)">
        {WEBSITE_FEATURES.map((feature) => (
          <label key={feature} style={{ display: 'inline-block', width: '16rem' }}>
            <input
              type="checkbox"
              checked={features.includes(feature)}
              onChange={() => toggle(feature)}
            />{' '}
            {feature.replaceAll('_', ' ')}
          </label>
        ))}
      </FieldGroup>
      {features.includes('appointment_booking') ? (
        <TextField
          label="Booking provider, if you use one (optional)"
          value={value.bookingProvider}
          maxLength={100}
          onChange={(v) => onChange(set(value, { bookingProvider: v }))}
        />
      ) : null}
      {features.includes('ecommerce') ? (
        <>
          <TextField
            label="Roughly how many products?"
            type="number"
            value={value.ecommerce?.approxProductCount?.toString()}
            onChange={(v) =>
              onChange(
                set(value, {
                  ecommerce: { ...value.ecommerce, approxProductCount: Number(v) || undefined },
                }),
              )
            }
          />
          <CheckboxField
            label="I need online payments"
            checked={value.ecommerce?.needsPayments}
            onChange={(v) =>
              onChange(set(value, { ecommerce: { ...value.ecommerce, needsPayments: v } }))
            }
          />
        </>
      ) : null}
      <SelectField
        label="How many pages do you expect?"
        value={value.pageExpectations}
        options={[
          { value: 'one_page', label: 'A single page' },
          { value: 'up_to_5', label: 'Up to 5 pages' },
          { value: 'up_to_10', label: 'Up to 10 pages' },
          { value: 'not_sure', label: 'Not sure yet' },
        ]}
        onChange={(v) => onChange(set(value, { pageExpectations: v }))}
      />
      <StringListField
        label="Tools to integrate (optional)"
        values={value.integrations}
        max={10}
        onChange={(v) => onChange(set(value, { integrations: v }))}
      />
      <TextArea
        label="Accessibility notes (optional)"
        value={value.accessibilityNotes}
        maxLength={500}
        onChange={(v) => onChange(set(value, { accessibilityNotes: v }))}
      />
    </>
  );
}
