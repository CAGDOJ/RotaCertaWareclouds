import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const trackingSessions = sqliteTable('tracking_sessions', {
  id: text('id').primaryKey(),
  ownerHash: text('owner_hash').notNull(),
  payload: text('payload').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('tracking_sessions_expiry').on(table.expiresAt)]);
