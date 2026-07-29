import { describe, expect, it } from 'vitest';

import { createTestWorld, registerVerifiedUser, type TestWorld } from './helpers';

const PASSWORD = 'a-strong-password';
const toBuffer = (text: string): ArrayBuffer =>
  new TextEncoder().encode(text).buffer as ArrayBuffer;
const PNG_BYTES = toBuffer('not-a-real-png-but-bytes-are-bytes');

async function ownerWithOrg(world: TestWorld, tag: string) {
  const owner = await registerVerifiedUser(world, {
    name: `Files Owner ${tag}`,
    email: `files-owner-${tag}@example.com`,
    password: PASSWORD,
  });
  const org = await world.services.organizations.create(owner.principal, {
    name: `Files Org ${tag}`,
    contactEmail: `files-${tag}@example.com`,
  });
  return { owner, org };
}

describe('file uploads (worker-proxied R2, ADR-0008 as amended)', () => {
  it('slot → upload → download roundtrip with checksum, audit and metadata', async () => {
    const world = createTestWorld();
    const { owner, org } = await ownerWithOrg(world, 'a');

    const slot = await world.services.files.requestUpload(owner.principal, org.id, {
      fileName: 'brand logo (final).png',
      contentType: 'image/png',
      sizeBytes: PNG_BYTES.byteLength,
      purpose: 'logo',
    });
    expect(slot.uploadPath).toContain(slot.fileId);

    const stored = await world.services.files.storeContent(
      owner.principal,
      org.id,
      slot.fileId,
      PNG_BYTES,
      'image/png',
    );
    expect(stored.sizeBytes).toBe(PNG_BYTES.byteLength);
    expect(stored.checksumSha256).toMatch(/^[a-f0-9]{64}$/);

    const download = await world.services.files.download(owner.principal, org.id, slot.fileId);
    expect(download.contentType).toBe('image/png');
    expect(download.fileName).toBe('brand logo (final).png');
    expect(download.inline).toBe(true);
    const received = await new Response(download.body).arrayBuffer();
    expect(new Uint8Array(received)).toEqual(new Uint8Array(PNG_BYTES));

    const listed = await world.services.files.listForOrganization(owner.principal, org.id);
    expect(listed).toHaveLength(1);

    const actions = (
      await world.services.audit.listForOrganization({ organizationId: org.id })
    ).map((event) => event.action);
    expect(actions).toContain('file.uploaded');
    expect(actions).toContain('file.downloaded');
  });

  it('rejects disallowed types and oversized declarations before issuing a slot', async () => {
    const world = createTestWorld();
    const { owner, org } = await ownerWithOrg(world, 'b');

    await expect(
      world.services.files.requestUpload(owner.principal, org.id, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        contentType: 'application/x-msdownload' as any,
        fileName: 'virus.exe',
        sizeBytes: 100,
        purpose: 'other',
      }),
    ).rejects.toThrow();

    await expect(
      world.services.files.requestUpload(owner.principal, org.id, {
        fileName: 'huge.pdf',
        contentType: 'application/pdf',
        sizeBytes: 26 * 1024 * 1024,
        purpose: 'copy_document',
      }),
    ).rejects.toThrow();
  });

  it('enforces upload invariants: size ceiling, content-type match, single store', async () => {
    const world = createTestWorld();
    const { owner, org } = await ownerWithOrg(world, 'c');
    const slot = await world.services.files.requestUpload(owner.principal, org.id, {
      fileName: 'notes.txt',
      contentType: 'text/plain',
      sizeBytes: 10,
      purpose: 'other',
    });

    // Larger than declared
    await expect(
      world.services.files.storeContent(
        owner.principal,
        org.id,
        slot.fileId,
        toBuffer('way more than ten bytes'),
        'text/plain',
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    // Wrong content type
    await expect(
      world.services.files.storeContent(
        owner.principal,
        org.id,
        slot.fileId,
        toBuffer('0123456789'),
        'application/pdf',
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    // Correct upload, then replay is a conflict
    await world.services.files.storeContent(
      owner.principal,
      org.id,
      slot.fileId,
      toBuffer('0123456789'),
      'text/plain',
    );
    await expect(
      world.services.files.storeContent(
        owner.principal,
        org.id,
        slot.fileId,
        toBuffer('0123456789'),
        'text/plain',
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('tenant isolation: outsiders can neither upload to nor read another org', async () => {
    const world = createTestWorld();
    const { owner, org } = await ownerWithOrg(world, 'd');
    const slot = await world.services.files.requestUpload(owner.principal, org.id, {
      fileName: 'private.pdf',
      contentType: 'application/pdf',
      sizeBytes: PNG_BYTES.byteLength,
      purpose: 'copy_document',
    });
    await world.services.files.storeContent(
      owner.principal,
      org.id,
      slot.fileId,
      PNG_BYTES,
      'application/pdf',
    );

    const outsider = await registerVerifiedUser(world, {
      name: 'Files Outsider',
      email: 'files-outsider@example.com',
      password: PASSWORD,
    });
    await expect(
      world.services.files.download(outsider.principal, org.id, slot.fileId),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      world.services.files.requestUpload(outsider.principal, org.id, {
        fileName: 'sneaky.png',
        contentType: 'image/png',
        sizeBytes: 10,
        purpose: 'other',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      world.services.files.listForOrganization(outsider.principal, org.id),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('cleans up abandoned upload slots after the orphan window', async () => {
    const world = createTestWorld();
    const { owner, org } = await ownerWithOrg(world, 'e');
    await world.services.files.requestUpload(owner.principal, org.id, {
      fileName: 'never-uploaded.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1000,
      purpose: 'copy_document',
    });

    // Within the window: nothing to clean.
    expect(await world.services.files.cleanupOrphans()).toBe(0);

    world.clock.advance(25 * 60 * 60 * 1000);
    expect(await world.services.files.cleanupOrphans()).toBe(1);

    const actions = (
      await world.services.audit.listForOrganization({ organizationId: org.id })
    ).map((event) => event.action);
    expect(actions).toContain('file.orphan_cleaned');
  });
});
