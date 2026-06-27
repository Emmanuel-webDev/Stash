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

  const savings = (spendAmount * BigInt(basisPoints)) / 10_000n
  if (savings === 0n) return

  log.tx(`User ${user} spent ${spendAmount} → saving ${savings} USDC units`)

  try {
    const hash = await walletClient.writeContract({
      address      : config.vaultAddress,
      abi          : VAULT_ABI,
      functionName : 'depositFor',
      args         : [user, savings],
    })

    log.ok(`depositFor submitted | user=${user} savings=${savings} tx=${hash}`)
    store.markLogProcessed(txHash, logIndex, user, spendAmount, savings)

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error(`depositFor failed | user=${user} | ${msg}`)
  }
}