import type { R2Bucket } from '@cloudflare/workers-types';
import type { Database, FileRow } from '@website-factory/db';
import { createFilesRepository, tenantContext } from '@website-factory/db';
import {
  INLINE_DISPLAY_TYPES,
  MAX_FILE_BYTES,
  requestUploadInputSchema,
  TENANT_STORAGE_QUOTA_BYTES,
  type RequestUploadInput,
} from '@website-factory/schemas';

import type { AuditService } from '../audit';
import { requireTenantPermission, requireVerified } from '../authz';
import type { Clock } from '../clock';
import { isoNow } from '../clock';
import { DomainError, notFound } from '../errors';
import { newId } from '../ids';
import type { Principal } from '../principal';
import { SYSTEM_ACTOR } from '../principal';
import type { OrganizationService } from './organizations';

const ORPHAN_MAX_AGE_HOURS = 24;

function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned.slice(0, 120) || 'file';
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface FileDownload {
  body: ReadableStream;
  contentType: string;
  fileName: string;
  sizeBytes: number;
  /** Non-image types always download as attachments (docs/security-model.md). */
  inline: boolean;
}

/**
 * File storage (ADR-0008 as amended for M3): worker-proxied uploads behind the
 * slot → upload → confirm API shape, bounded to MAX_FILE_BYTES per file and a
 * per-tenant quota. R2 keys are `{org}/{fileId}/{sanitized-name}` — never
 * user-controlled paths — and the bucket is never publicly readable; all reads
 * go through the authenticated, tenant-checked download method.
 */
export class FileService {
  private readonly repo;

  constructor(
    private readonly db: Database,
    private readonly r2: R2Bucket,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationService,
  ) {
    this.repo = createFilesRepository(db);
  }

  private async requireUploadAccess(principal: Principal, organizationId: string) {
    requireVerified(principal);
    const membership = await this.organizations.membershipFor(principal, organizationId);
    requireTenantPermission(membership, 'files.upload');
    return tenantContext(organizationId);
  }

  private async requireViewAccess(principal: Principal, organizationId: string) {
    requireVerified(principal);
    const membership = await this.organizations.membershipFor(principal, organizationId);
    requireTenantPermission(membership, 'organization.view');
    return tenantContext(organizationId);
  }

  async requestUpload(
    principal: Principal,
    organizationId: string,
    input: RequestUploadInput,
  ): Promise<{ fileId: string; uploadPath: string }> {
    const ctx = await this.requireUploadAccess(principal, organizationId);
    const data = requestUploadInputSchema.parse(input);

    const used = await this.repo.storedBytes(ctx);
    if (used + data.sizeBytes > TENANT_STORAGE_QUOTA_BYTES) {
      throw new DomainError('validation_failed', 'Storage quota exceeded for this organization');
    }

    const fileId = newId();
    const now = isoNow(this.clock);
    await this.repo.createPending(ctx, {
      id: fileId,
      organizationId,
      r2Key: `${organizationId}/${fileId}/${sanitizeFileName(data.fileName)}`,
      originalName: data.fileName,
      contentType: data.contentType,
      sizeBytes: data.sizeBytes,
      purpose: data.purpose,
      status: 'pending',
      uploadedBy: principal.userId,
      createdAt: now,
      updatedAt: now,
    });
    return {
      fileId,
      uploadPath: `/api/organizations/${organizationId}/files/${fileId}/content`,
    };
  }

  async storeContent(
    principal: Principal,
    organizationId: string,
    fileId: string,
    content: ArrayBuffer,
    declaredContentType: string | null,
  ): Promise<{ sizeBytes: number; checksumSha256: string }> {
    const ctx = await this.requireUploadAccess(principal, organizationId);
    const row = await this.repo.findById(ctx, fileId);
    if (!row) throw notFound('file');
    if (row.status !== 'pending') {
      throw new DomainError('conflict', 'This file has already been uploaded');
    }
    if (content.byteLength === 0 || content.byteLength > MAX_FILE_BYTES) {
      throw new DomainError('validation_failed', 'File size is out of bounds');
    }
    if (content.byteLength > row.sizeBytes) {
      throw new DomainError('validation_failed', 'File is larger than the declared size');
    }
    if (declaredContentType && declaredContentType !== row.contentType) {
      throw new DomainError('validation_failed', 'Content type does not match the upload slot');
    }

    const checksumSha256 = await sha256Hex(content);
    await this.r2.put(row.r2Key, content, {
      httpMetadata: { contentType: row.contentType },
    });
    const stored = await this.repo.markStored(ctx, fileId, {
      checksumSha256,
      sizeBytes: content.byteLength,
      updatedAt: isoNow(this.clock),
    });
    if (!stored) throw new DomainError('conflict', 'This file has already been uploaded');

    await this.audit.record({
      action: 'file.uploaded',
      resourceType: 'file',
      resourceId: fileId,
      organizationId,
      actor: { type: 'user', id: principal.userId },
      metadata: { purpose: row.purpose, sizeBytes: content.byteLength },
    });
    return { sizeBytes: content.byteLength, checksumSha256 };
  }

  async download(
    principal: Principal,
    organizationId: string,
    fileId: string,
  ): Promise<FileDownload> {
    const ctx = await this.requireViewAccess(principal, organizationId);
    const row = await this.repo.findById(ctx, fileId);
    if (!row || row.status !== 'stored') throw notFound('file');

    const object = await this.r2.get(row.r2Key);
    if (!object) throw notFound('file');

    await this.audit.record({
      action: 'file.downloaded',
      resourceType: 'file',
      resourceId: fileId,
      organizationId,
      actor: { type: 'user', id: principal.userId },
    });
    return {
      body: object.body as unknown as ReadableStream,
      contentType: row.contentType,
      fileName: row.originalName,
      sizeBytes: row.sizeBytes,
      inline: INLINE_DISPLAY_TYPES.has(row.contentType),
    };
  }

  async listForOrganization(principal: Principal, organizationId: string) {
    const ctx = await this.requireViewAccess(principal, organizationId);
    const rows = await this.repo.listForOrganization(ctx);
    return rows.map((row: FileRow) => ({
      id: row.id,
      fileName: row.originalName,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      purpose: row.purpose,
      createdAt: row.createdAt,
    }));
  }

  /** System job: sweep upload slots that never received content. */
  async cleanupOrphans(): Promise<number> {
    const cutoff = new Date(
      this.clock.now().getTime() - ORPHAN_MAX_AGE_HOURS * 60 * 60 * 1000,
    ).toISOString();
    const orphans = await this.repo.listPendingOlderThan(cutoff);
    for (const orphan of orphans) {
      await this.r2.delete(orphan.r2Key);
      await this.repo.markDeleted(orphan.id, isoNow(this.clock));
      await this.audit.record({
        action: 'file.orphan_cleaned',
        resourceType: 'file',
        resourceId: orphan.id,
        organizationId: orphan.organizationId,
        actor: SYSTEM_ACTOR,
      });
    }
    return orphans.length;
  }
}
