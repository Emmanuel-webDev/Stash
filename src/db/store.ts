/**
 * store.ts
 *
 * All DB access goes through prepared statements compiled once at module load.
 * better-sqlite3 is synchronous — zero async overhead on the hot idempotency
 * check path. Reads and writes take < 0.1ms in WAL mode.
 *
 * Query design:
 *   getActiveUser  → covering index scan (address + is_listening) — no heap read
 *   isLogProcessed → PRIMARY KEY lookup — O(log n) B-tree
 *   markProcessed  → INSERT OR IGNORE — single write, no read before write
 */

import Database from 'better-sqlite3'
import { resolve } from 'path'
import { applySchema } from './schema.js'

const db = new Database(resolve(process.cwd(), 'relayer.db'))
db.pragma('journal_mode = WAL')
db.pragma('synchronous  = NORMAL')

// Ensures the schema exists even if `npm run db:migrate` was never run —
// required on Render's free tier, where the disk is wiped on every redeploy.
applySchema(db)

// ── Compiled prepared statements (one-time cost at startup) ──────────────────
const q = {
  upsertUser: db.prepare(`
    INSERT INTO registered_users (address, basis_points, is_listening, updated_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(address) DO UPDATE SET
      basis_points = excluded.basis_points,
      is_listening = 1,
      updated_at   = datetime('now')
  `),

  pauseUser: db.prepare(`
    UPDATE registered_users
    SET is_listening = 0, updated_at = datetime('now')
    WHERE address = ?
  `),

  resumeUser: db.prepare(`
    UPDATE registered_users
    SET is_listening = 1, updated_at = datetime('now')
    WHERE address = ?
  `),

  // Hot path — called on every USDC Transfer event
  // Returns { basis_points } row or undefined (no full row scan needed)
  getActiveUser: db.prepare(`
    SELECT basis_points FROM registered_users
    WHERE address = ? AND is_listening = 1
  `),

  getAllActive: db.prepare(`
    SELECT address, basis_points FROM registered_users WHERE is_listening = 1
  `),

  // PK lookup — fastest possible existence check
  isProcessed: db.prepare(`
    SELECT 1 FROM processed_logs WHERE log_id = ?
  `),

  // INSERT OR IGNORE — idempotent, no pre-check needed
  markProcessed: db.prepare(`
    INSERT OR IGNORE INTO processed_logs
      (log_id, user_address, spend_amount, savings_amount)
    VALUES (?, ?, ?, ?)
  `),
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ActiveUser  { basis_points: number }
export interface StoredUser  { address: string; basis_points: number }

export const store = {
  // Called when Configured() vault event fires
  upsertUser(address: string, basisPoints: number): void {
    q.upsertUser.run(address.toLowerCase(), basisPoints)
  },

  // Called when ListeningPaused() vault event fires
  pauseUser(address: string): void {
    q.pauseUser.run(address.toLowerCase())
  },

  // Called when ListeningResumed() vault event fires
  resumeUser(address: string): void {
    q.resumeUser.run(address.toLowerCase())
  },

  // Hot path: returns basis_points if user is active, undefined otherwise
  // Synchronous — no promise/await overhead on every Transfer event
  getActiveUser(address: string): ActiveUser | undefined {
    return q.getActiveUser.get(address.toLowerCase()) as ActiveUser | undefined
  },

  getAllActive(): StoredUser[] {
    return q.getAllActive.all() as StoredUser[]
  },

  isLogProcessed(txHash: string, logIndex: number): boolean {
    return !!q.isProcessed.get(`${txHash}-${logIndex}`)
  },

  markLogProcessed(
    txHash: string,
    logIndex: number,
    user: string,
    spendAmount: bigint,
    savingsAmount: bigint,
  ): void {
    q.markProcessed.run(
      `${txHash}-${logIndex}`,
      user.toLowerCase(),
      spendAmount.toString(),
      savingsAmount.toString(),
    )
  },
}
