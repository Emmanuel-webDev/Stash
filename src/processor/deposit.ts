import { config } from '../config.js'
import { walletClient } from '../utils/clients.js'
import { store } from '../db/store.js'
import { log } from '../utils/logger.js'
import { VAULT_ABI } from '../abis.js'

export async function executeDeposit(
  user        : `0x${string}`,
  basisPoints : number,
  spendAmount : bigint,
  txHash      : string,
  logIndex    : number,
): Promise<void> {
  if (store.isLogProcessed(txHash, logIndex)) {
    log.skip(`Already processed ${txHash}-${logIndex}`)
    return
  }

  // Computed here only for logging/DB bookkeeping — the contract recomputes
  // this itself from spendAmount and the user's on-chain basisPoints, so
  // this relayer-side number is never trusted directly by depositFor.
  const expectedSavings = (spendAmount * BigInt(basisPoints)) / 10_000n
  if (expectedSavings === 0n) return

  log.tx(`User ${user} spent ${spendAmount} → expecting ~${expectedSavings} USDC saved`)

  try {
    const hash = await walletClient.writeContract({
      address      : config.vaultAddress,
      abi          : VAULT_ABI,
      functionName : 'depositFor',
      args         : [user, spendAmount],
    })

    log.ok(`depositFor submitted | user=${user} spend=${spendAmount} tx=${hash}`)
    store.markLogProcessed(txHash, logIndex, user, spendAmount, expectedSavings)
    // In case this succeeded on a retry after a prior failure (e.g. the user
    // topped up their approval), clear it from the missed-savings list.
    store.resolveFailedDeposit(txHash, logIndex)

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error(`depositFor failed | user=${user} | ${msg}`)
    // Most commonly an insufficient-allowance revert — the user wasn't around
    // to re-approve in time. Recorded (not dropped) so retryMissedDeposits()
    // can catch it up automatically once the allowance is restored, and so
    // the user can see it in the meantime via GET /missed/:address.
    store.recordFailedDeposit(txHash, logIndex, user, spendAmount, msg)
  }
}