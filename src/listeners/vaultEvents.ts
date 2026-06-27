/**
 * vaultEvents.ts
 *
 * Polls vault events over HTTP using getLogs on each new block.
 * No WebSocket dependency — works even when Arc's WS node is down.
 */

import { parseAbiItem, type PublicClient } from 'viem'
import { config } from '../config.js'
import { store } from '../db/store.js'
import { log } from '../utils/logger.js'

const CONFIGURED_ABI       = parseAbiItem('event Configured(address indexed user, uint256 basisPoints)')
const PAUSED_ABI           = parseAbiItem('event ListeningPaused(address indexed user)')
const RESUMED_ABI          = parseAbiItem('event ListeningResumed(address indexed user)')

export function startVaultEventListeners(publicClient: PublicClient): void {
  log.info(`Watching vault events @ ${config.vaultAddress} (HTTP polling)`)

  let lastBlock = 0n

  publicClient.watchBlocks({
    onBlock: async (block) => {
      // Skip if same block processed twice (can happen on reconnect)
      if (block.number <= lastBlock) return
      lastBlock = block.number

      try {
        // Fetch all three event types in parallel — faster than sequential awaits
        const [configuredLogs, pausedLogs, resumedLogs] = await Promise.all([
          publicClient.getLogs({
            address   : config.vaultAddress,
            event     : CONFIGURED_ABI,
            fromBlock : block.number,
            toBlock   : block.number,
          }),
          publicClient.getLogs({
            address   : config.vaultAddress,
            event     : PAUSED_ABI,
            fromBlock : block.number,
            toBlock   : block.number,
          }),
          publicClient.getLogs({
            address   : config.vaultAddress,
            event     : RESUMED_ABI,
            fromBlock : block.number,
            toBlock   : block.number,
          }),
        ])

        for (const l of configuredLogs) {
          const user        = l.args.user        as `0x${string}`
          const basisPoints = Number(l.args.basisPoints)
          log.event(`Configured: ${user} @ ${basisPoints}bp`)
          store.upsertUser(user, basisPoints)
        }

        for (const l of pausedLogs) {
          const user = l.args.user as `0x${string}`
          log.event(`ListeningPaused: ${user}`)
          store.pauseUser(user)
        }

        for (const l of resumedLogs) {
          const user = l.args.user as `0x${string}`
          log.event(`ListeningResumed: ${user}`)
          store.resumeUser(user)
        }

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error(`Vault getLogs failed @ block ${block.number}: ${msg}`)
      }
    },
    onError: (err) => log.error('watchBlocks[vault]:', err.message),
  })
}