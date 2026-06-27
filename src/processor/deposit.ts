/**
 * deposit.ts
 *
 * Bridges a detected USDC spend → vault depositFor UserOperation.
 *
 * Execution path (optimized for speed):
 *   1. Synchronous SQLite idempotency check (< 0.1ms) — gate before any async
 *   2. Compute savings with BigInt arithmetic — zero float risk
 *   3. Send UserOperation via Pimlico bundler — gas paid in USDC via paymaster
 *   4. Mark log processed only after confirmed submission
 *
 * Why UserOperation instead of a raw tx?
 *   - No nonce management — bundler handles ordering
 *   - Gas paid in USDC via Pimlico paymaster — no ETH needed
 *   - If the vault reverts (e.g. user paused on-chain), the UserOp fails cleanly
 *     without a stuck nonce blocking future deposits
 */

import type { SmartAccountClient } from 'permissionless'
import { config } from '../config.js'
import { store } from '../db/store.js'
import { log } from '../utils/logger.js'
import { encodeDepositFor } from '../utils/clients.js'

export async function executeDeposit(
  smartAccountClient: SmartAccountClient,
  user            : `0x${string}`,
  basisPoints     : number,
  spendAmount     : bigint,
  txHash          : string,
  logIndex        : number,
): Promise<void> {
  // ── 1. Idempotency gate — synchronous, zero async overhead ─────────────────
  if (store.isLogProcessed(txHash, logIndex)) {
    log.skip(`Already processed log ${txHash}-${logIndex}`)
    return
  }

  // ── 2. Compute savings amount ───────────────────────────────────────────────
  // BigInt throughout — no floating-point precision risk
  const savings = (spendAmount * BigInt(basisPoints)) / 10_000n
  if (savings === 0n) return

  log.tx(`Spend detected | user=${user} spent=${spendAmount} saving=${savings}`)

  try {
    // ── 3. Submit UserOperation via Pimlico bundler ───────────────────────────
    // sendTransaction on a smart account client builds + sends a UserOp:
    //   - Pimlico paymaster signs it (gas sponsored in USDC)
    //   - Bundler submits it to Arc testnet
    //   - Arc's Malachite consensus finalizes it sub-second
    const userOpHash = await smartAccountClient.sendTransaction({
      to    : config.vaultAddress,
      data  : encodeDepositFor(user, savings),
      value : 0n,
    })

    log.ok(`UserOp submitted | user=${user} savings=${savings} hash=${userOpHash}`)

    // ── 4. Mark processed only after successful submission ────────────────────
    // If bundler throws (e.g. paymaster rejected), we don't mark — safe to retry
    store.markLogProcessed(txHash, logIndex, user, spendAmount, savings)

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error(`depositFor UserOp failed | user=${user} | ${msg}`)
    // Intentionally NOT marking as processed — will retry on next matching log
  }
}
