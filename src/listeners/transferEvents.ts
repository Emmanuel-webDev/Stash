import { parseAbiItem, type PublicClient } from 'viem'
import { config } from '../config.js'
import { store } from '../db/store.js'
import { log } from '../utils/logger.js'
import { executeDeposit } from '../processor/deposit.js'
import { relayerAccount } from '../utils/clients.js'

const TRANSFER_ABI = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
)

// Arc system emitter — single source of truth for ALL USDC movements
// Emits Transfer events for wallet sends, swaps, NFT mints, contract calls
// Values are in 18 decimals — normalize to 6 for vault
const SYSTEM_EMITTER  = '0xfffffffffffffffffffffffffffffffffffffffe' as `0x${string}`
const DECIMAL_DIVISOR = 1_000_000_000_000n // 10^12: 18dec → 6dec

export function startTransferListener(publicClient: PublicClient): void {
  log.info(`Listening to Arc system emitter @ ${SYSTEM_EMITTER}`)

  const vaultAddr   = config.vaultAddress.toLowerCase()
  const relayerAddr = relayerAccount.address.toLowerCase()

  let lastBlock = 0n

  publicClient.watchBlocks({
    onBlock: async (block) => {
      if (!block.number || block.number <= lastBlock) return
      lastBlock = block.number

      try {
        // One getLogs call on the system emitter catches everything:
        // wallet sends, DEX swaps, NFT mints, merchant payments, contract calls
        const logs = await publicClient.getLogs({
          address   : SYSTEM_EMITTER,
          event     : TRANSFER_ABI,
          fromBlock : block.number,
          toBlock   : block.number,
        })

        if (logs.length === 0) return

        for (const l of logs) {
          const from  = (l.args.from  as string | undefined)?.toLowerCase()
          const to    = (l.args.to    as string | undefined)?.toLowerCase()
          const value =  l.args.value as bigint | undefined

          if (!from || !to || !value || value === 0n) continue

          // Skip relayer's own depositFor transactions
          if (from === relayerAddr) continue

          // Skip transfers going into the vault
          if (to === vaultAddr) continue

          // Check if sender is a registered active user
          const user = store.getActiveUser(from)
          if (!user) continue

          if (store.isLogProcessed(l.transactionHash!, l.logIndex!)) continue

          // Normalize 18 decimals → 6 decimals
          const normalizedValue = value / DECIMAL_DIVISOR
          if (normalizedValue === 0n) continue

          log.event(`Spend: ${from} amount=${normalizedValue} USDC tx=${l.transactionHash}`)

          void executeDeposit(
            from as `0x${string}`,
            user.basis_points,
            normalizedValue,
            l.transactionHash!,
            l.logIndex!,
          )
        }
      } catch (err: unknown) {
        log.error(`block ${block.number}: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    onError: (err) => log.error('watchBlocks:', err.message),
  })
}