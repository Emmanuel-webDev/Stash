import { parseAbiItem, type PublicClient } from 'viem'
import { config } from '../config.js'
import { store } from '../db/store.js'
import { log } from '../utils/logger.js'
import { executeDeposit } from '../processor/deposit.js'

const TRANSFER_ABI = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
)

export function startTransferListener(publicClient: PublicClient): void {
  log.info(`Watching USDC transfers @ ${config.usdcAddress}`)

  let lastBlock = 0n

  publicClient.watchBlocks({
    onBlock: async (block) => {
      if (block.number === null || block.number <= lastBlock) return
      lastBlock = block.number

      try {
        const logs = await publicClient.getLogs({
          address   : config.usdcAddress,
          event     : TRANSFER_ABI,
          fromBlock : block.number,
          toBlock   : block.number,
        })

        for (const l of logs) {
          const from  = l.args.from  as `0x${string}` | undefined
          const value = l.args.value as bigint | undefined

          if (!from || !value || value === 0n) continue

          const user = store.getActiveUser(from)
          if (!user) continue

          if (store.isLogProcessed(l.transactionHash!, l.logIndex!)) continue

          log.event(`Spend: ${from} amount=${value}`)

          void executeDeposit(
            from,
            user.basis_points,
            value,
            l.transactionHash!,
            l.logIndex!,
          )
        }
      } catch (err: unknown) {
        log.error(`transferEvents block ${block.number}: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    onError: (err) => log.error('watchBlocks[transfer]:', err.message),
  })
}