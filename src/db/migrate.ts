/**
 * Run once before starting: npm run db:migrate
 *
 * registered_users — wallets the relayer watches (synced from vault events)
 * processed_logs   — idempotency table (prevents double-deposits on WS replay)
 */

import Database from 'better-sqlite3'
import { resolve } from 'path'

const db = new Database(resolve(process.cwd(), 'relayer.db'))

// WAL mode: concurrent reads don't block writes — critical for a hot-path relayer
db.pragma('journal_mode = WAL')
db.pragma('synchronous  = NORMAL') // safe with WAL; faster than FULL

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

console.log('✅ DB migrated → relayer.db')
db.close()
