import type Database from 'better-sqlite3'

/**
 * Idempotent — safe to call on every boot. Render's free tier gives the
 * service an ephemeral disk (wiped on redeploy/restart), so relying on a
 * one-off `npm run db:migrate` step isn't enough in production; this runs
 * automatically wherever the DB is opened (see store.ts).
 */
export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS registered_users (
      address       TEXT    PRIMARY KEY,        -- lowercase 0x address
      basis_points  INTEGER NOT NULL,           -- 100–2000
      is_listening  INTEGER NOT NULL DEFAULT 1, -- 1=active, 0=paused
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Covering index: the hot query is "give me basis_points for active address X"
    -- This index makes that a pure index scan — no table touch needed
    CREATE INDEX IF NOT EXISTS idx_users_active
      ON registered_users(address, is_listening)
      WHERE is_listening = 1;

    CREATE TABLE IF NOT EXISTS processed_logs (
      log_id         TEXT PRIMARY KEY,   -- "{txHash}-{logIndex}"
      user_address   TEXT NOT NULL,
      spend_amount   TEXT NOT NULL,      -- bigint stored as string
      savings_amount TEXT NOT NULL,
      processed_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}
