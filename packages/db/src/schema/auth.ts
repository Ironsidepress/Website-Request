import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/**
 * Better Auth tables (ADR-0003).
 *
 * These tables are OWNED BY BETTER AUTH via its Drizzle adapter. Application
 * code must never read or write them directly — identity flows through the
 * `AuthService` adapter in @website-factory/core, which maps authenticated
 * subjects into the application's own `users` table (schema/app.ts).
 *
 * Property names match Better Auth's default field names; column names follow
 * the repository's snake_case convention.
 */

export const baUser = sqliteTable('ba_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const baSession = sqliteTable(
  'ba_session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => baUser.id, { onDelete: 'cascade' }),
  },
  (table) => [index('idx_ba_session_user').on(table.userId)],
);

export const baAccount = sqliteTable(
  'ba_account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => baUser.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('idx_ba_account_user').on(table.userId)],
);

export const baVerification = sqliteTable(
  'ba_verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('idx_ba_verification_identifier').on(table.identifier)],
);

/** Storage for Better Auth's built-in rate limiter (storage: 'database'). */
export const baRateLimit = sqliteTable('ba_rate_limit', {
  id: text('id').primaryKey(),
  key: text('key'),
  count: integer('count'),
  lastRequest: integer('last_request'),
});
