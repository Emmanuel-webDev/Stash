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

  // Upsert on retry: bump attempts + last_error instead of duplicating rows
  recordFailed: db.prepare(`
    INSERT INTO failed_deposits (log_id, user_address, spend_amount, last_error)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(log_id) DO UPDATE SET
      attempts        = attempts + 1,
      last_error      = excluded.last_error,
      last_attempt_at = datetime('now')
  `),

  resolveFailed: db.prepare(`
    DELETE FROM failed_deposits WHERE log_id = ?
  `),

  getAllFailedDeposits: db.prepare(`
    SELECT log_id, user_address, spend_amount FROM failed_deposits
  `),

  getFailedDepositsForUser: db.prepare(`
    SELECT log_id, spend_amount FROM failed_deposits WHERE user_address = ?
  `),
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ActiveUser  { basis_points: number }
export interface StoredUser  { address: string; basis_points: number }
export interface FailedDeposit { log_id: string; user_address: string; spend_amount: string }

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

  // A depositFor call reverted (most commonly: insufficient USDC approval).
  // Recorded so it can be retried later and shown to the user in the meantime.
  recordFailedDeposit(
    txHash: string,
    logIndex: number,
    user: string,
    spendAmount: bigint,
    error: string,
  ): void {
    q.recordFailed.run(`${txHash}-${logIndex}`, user.toLowerCase(), spendAmount.toString(), error)
  },

  resolveFailedDeposit(txHash: string, logIndex: number): void {
    q.resolveFailed.run(`${txHash}-${logIndex}`)
  },

  getAllFailedDeposits(): FailedDeposit[] {
    return q.getAllFailedDeposits.all() as FailedDeposit[]
  },

  // Sums missed spend amounts for one user — used by GET /missed/:address
  getMissedSummary(address: string): { count: number; totalSpendAmount: string } {
    const rows = q.getFailedDepositsForUser.all(address.toLowerCase()) as { spend_amount: string }[]
    const total = rows.reduce((acc, r) => acc + BigInt(r.spend_amount), 0n)
    return { count: rows.length, totalSpendAmount: total.toString() }
  },
}
