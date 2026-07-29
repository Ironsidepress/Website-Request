'use client';

import { useEffect, useRef, useState } from 'react';

import { FieldGroup } from './fields';

interface FileMeta {
  id: string;
  fileName: string;
}

/**
 * Upload widget for intake sections: slot → PUT bytes → attach the file id to
 * the section's draft data. Removal detaches the reference only; storage
 * lifecycle stays server-side.
 */
export function FileUploadField(props: {
  label: string;
  organizationId: string;
  purpose: 'logo' | 'brand_guide' | 'photo' | 'copy_document' | 'other';
  accept: string;
  value: string[] | undefined;
  onChange: (fileIds: string[]) => void;
  max: number;
}) {
  const value = props.value ?? [];
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      const response = await fetch(`/api/organizations/${props.organizationId}/files`);
      if (!response.ok) return;
      const listed = (await response.json()) as FileMeta[];
      setNames(Object.fromEntries(listed.map((file) => [file.id, file.fileName])));
    })();
  }, [props.organizationId]);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const slotResponse = await fetch(`/api/organizations/${props.organizationId}/files`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          purpose: props.purpose,
        }),
      });
      if (!slotResponse.ok) {
        const body = (await slotResponse.json()) as { message?: string };
        throw new Error(body.message ?? 'This file cannot be uploaded');
      }
      const slot = (await slotResponse.json()) as { fileId: string; uploadPath: string };
      const putResponse = await fetch(slot.uploadPath, {
        method: 'PUT',
        headers: { 'content-type': file.type },
        body: file,
      });
      if (!putResponse.ok) throw new Error('Upload failed — please try again');
      setNames((current) => ({ ...current, [slot.fileId]: file.name }));
      props.onChange([...value, slot.fileId]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <FieldGroup label={props.label}>
      <ul>
        {value.map((fileId) => (
          <li key={fileId}>
            {names[fileId] ?? 'Uploaded file'}{' '}
            <button
              type="button"
              onClick={() => props.onChange(value.filter((id) => id !== fileId))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {value.length < props.max ? (
        <input
          ref={inputRef}
          type="file"
          accept={props.accept}
          disabled={busy}
          aria-label={`${props.label} file`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      ) : null}
      {busy ? <p role="status">Uploading…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </FieldGroup>
  );
}
