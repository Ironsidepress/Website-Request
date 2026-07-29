'use client';

import type { ReactNode } from 'react';

/** Minimal controlled form helpers for the intake wizard (M2 — unstyled). */

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block', margin: '0.5rem 0' }}>
      <span style={{ display: 'block', fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}

export function TextField(props: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  maxLength?: number;
  type?: string;
}) {
  return (
    <Field label={props.label}>
      <input
        type={props.type ?? 'text'}
        value={props.value ?? ''}
        maxLength={props.maxLength ?? 500}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </Field>
  );
}

export function TextArea(props: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  maxLength?: number;
}) {
  return (
    <Field label={props.label}>
      <textarea
        value={props.value ?? ''}
        maxLength={props.maxLength ?? 2000}
        rows={3}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </Field>
  );
}

export function SelectField(props: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <Field label={props.label}>
      <select value={props.value ?? ''} onChange={(e) => props.onChange(e.target.value)}>
        <option value="" disabled>
          Choose…
        </option>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckboxField(props: {
  label: string;
  checked: boolean | undefined;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label style={{ display: 'block', margin: '0.5rem 0' }}>
      <input
        type="checkbox"
        checked={props.checked ?? false}
        onChange={(e) => props.onChange(e.target.checked)}
      />{' '}
      {props.label}
    </label>
  );
}

export function RadioChoice(props: {
  label: string;
  name: string;
  value: boolean | undefined;
  onChange: (value: boolean) => void;
  yesLabel: string;
  noLabel: string;
}) {
  return (
    <fieldset style={{ margin: '0.5rem 0' }}>
      <legend style={{ fontWeight: 600 }}>{props.label}</legend>
      <label>
        <input
          type="radio"
          name={props.name}
          checked={props.value === true}
          onChange={() => props.onChange(true)}
        />{' '}
        {props.yesLabel}
      </label>{' '}
      <label>
        <input
          type="radio"
          name={props.name}
          checked={props.value === false}
          onChange={() => props.onChange(false)}
        />{' '}
        {props.noLabel}
      </label>
    </fieldset>
  );
}

/** Group container: unlike Field, children keep their own accessible names. */
export function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset style={{ margin: '0.5rem 0' }}>
      <legend style={{ fontWeight: 600 }}>{label}</legend>
      {children}
    </fieldset>
  );
}

export function StringListField(props: {
  label: string;
  values: string[] | undefined;
  onChange: (values: string[]) => void;
  max: number;
  placeholder?: string;
}) {
  const values = props.values ?? [];
  return (
    <FieldGroup label={props.label}>
      {values.map((value, index) => (
        <span key={index} style={{ display: 'block' }}>
          <input
            value={value}
            placeholder={props.placeholder}
            aria-label={`${props.label} ${index + 1}`}
            onChange={(e) => {
              const next = [...values];
              next[index] = e.target.value;
              props.onChange(next);
            }}
          />
          <button
            type="button"
            onClick={() => props.onChange(values.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </span>
      ))}
      {values.length < props.max ? (
        <button type="button" onClick={() => props.onChange([...values, ''])}>
          Add
        </button>
      ) : null}
    </FieldGroup>
  );
}
