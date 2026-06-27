/**
 * transferEvents.ts
 *
 * Polls USDC Transfer events over HTTP using getLogs per block.
 * No WebSocket dependency.
 */

import { parseAbiItem, type PublicClient } from 'viem'
import type { SmartAccountClient } from 'permissionless'
import { config } from '../config.js'
import { store } from '../db/store.js'
import { log } from '../utils/logger.js'
import { executeDeposit } from '../processor/deposit.js'

const TRANSFER_ABI = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
)

export function startTransferListener(
  publicClient      : PublicClient,
  smartAccountClient: SmartAccountClient,
): void {
  log.info(`Watching USDC transfers @ ${config.usdcAddress} (HTTP polling)`)

  let lastBlock = 0n

  publicClient.watchBlocks({
    onBlock: async (block) => {
      log.info(`Block received: ${block.number}`)
      if (block.number <= lastBlock) return
      lastBlock = block.number

      try {
        const logs = await publicClient.getLogs({
          address   : config.usdcAddress,
          event     : TRANSFER_ABI,
          fromBlock : block.number,
          toBlock   : block.number,
        })

        log.info(`Logs found in block ${block.number}: ${logs.length}`)
    for (const l of logs) {
      log.info(`  Transfer from=${l.args.from} value=${l.args.value}`)
    }

        if (logs.length === 0) return

        for (const l of logs) {
          const from  = l.args.from  as `0x${string}` | undefined
          const value = l.args.value as bigint | undefined

          if (!from || !value || value === 0n) continue

          const user = store.getActiveUser(from)
          if (!user) continue

          if (store.isLogProcessed(l.transactionHash!, l.logIndex!)) continue

          log.event(`Spend detected | user=${from} amount=${value}`)

          void executeDeposit(
            smartAccountClient,
            from,
            user.basis_points,
            value,
            l.transactionHash!,
            l.logIndex!,
          )
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error(`USDC getLogs failed @ block ${block.number}: ${msg}`)
      }
    },
    onError: (err) => log.error('watchBlocks[transfer]:', err.message),
  })
}