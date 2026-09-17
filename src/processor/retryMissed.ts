import { store } from '../db/store.js'
import { executeDeposit } from './deposit.js'
import { log } from '../utils/logger.js'

/**
 * Periodic sweep over every recorded failed deposit (see schema.ts —
 * failed_deposits). Most failures are an insufficient-approval revert, so
 * this naturally resolves itself once the user tops up — no manual trigger
 * needed. Runs on a timer from index.ts.
 */
export async function retryMissedDeposits(): Promise<void> {
  const failed = store.getAllFailedDeposits()
  if (failed.length === 0) return

  log.info(`Retrying ${failed.length} missed deposit(s)...`)

  for (const row of failed) {
    const [txHash, logIndexStr] = row.log_id.split('-')
    const logIndex = Number(logIndexStr)
    const user = row.user_address as `0x${string}`

    // Skip if the user isn't currently active/listening (e.g. paused) — no
    // basisPoints to retry with right now. Picked up again on a later sweep.
    const active = store.getActiveUser(user)
    if (!active) continue

    await executeDeposit(user, active.basis_points, BigInt(row.spend_amount), txHash, logIndex)
  }
}
