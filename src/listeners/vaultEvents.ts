import { parseAbiItem, type PublicClient } from 'viem'
import { config } from '../config.js'
import { store } from '../db/store.js'
import { log } from '../utils/logger.js'

const CONFIGURED_ABI = parseAbiItem('event Configured(address indexed user, uint256 basisPoints)')
const PAUSED_ABI     = parseAbiItem('event ListeningPaused(address indexed user)')
const RESUMED_ABI    = parseAbiItem('event ListeningResumed(address indexed user)')

const CHUNK_SIZE = 9_000n // Arc RPC limit is 10,000 blocks per getLogs request

async function backfill(publicClient: PublicClient, fromBlock: bigint, toBlock: bigint): Promise<void> {
  log.info(`Backfilling vault events from block ${fromBlock} to ${toBlock}...`)

  let totalConfigured = 0

  for (let from = fromBlock; from <= toBlock; from += CHUNK_SIZE) {
    const to = from + CHUNK_SIZE - 1n > toBlock ? toBlock : from + CHUNK_SIZE - 1n

    const [configured, paused, resumed] = await Promise.all([
      publicClient.getLogs({ address: config.vaultAddress, event: CONFIGURED_ABI, fromBlock: from, toBlock: to }),
      publicClient.getLogs({ address: config.vaultAddress, event: PAUSED_ABI,     fromBlock: from, toBlock: to }),
      publicClient.getLogs({ address: config.vaultAddress, event: RESUMED_ABI,    fromBlock: from, toBlock: to }),
    ])

    for (const l of configured) {
      store.upsertUser(l.args.user as `0x${string}`, Number(l.args.basisPoints))
      log.event(`[backfill] Configured: ${l.args.user} @ ${l.args.basisPoints}bp`)
      totalConfigured++
    }
    for (const l of paused)  { store.pauseUser(l.args.user  as `0x${string}`); log.event(`[backfill] Paused: ${l.args.user}`) }
    for (const l of resumed) { store.resumeUser(l.args.user as `0x${string}`); log.event(`[backfill] Resumed: ${l.args.user}`) }
  }

  log.ok(`Backfill done — ${totalConfigured} users loaded`)
}

export async function startVaultEventListeners(publicClient: PublicClient): Promise<void> {
  log.info(`Watching vault @ ${config.vaultAddress}`)

  const currentBlock = await publicClient.getBlockNumber()

  // Start backfill from vault deploy block — avoids scanning millions of irrelevant blocks
  // VAULT_DEPLOY_BLOCK must be set in .env (check testnet.arcscan.app for your contract's deploy block)
  await backfill(publicClient, config.vaultDeployBlock, currentBlock)

  let lastBlock = currentBlock

  publicClient.watchBlocks({
    onBlock: async (block) => {
      if (block.number === null || block.number <= lastBlock) return
      lastBlock = block.number

      try {
        const [configured, paused, resumed] = await Promise.all([
          publicClient.getLogs({ address: config.vaultAddress, event: CONFIGURED_ABI, fromBlock: block.number, toBlock: block.number }),
          publicClient.getLogs({ address: config.vaultAddress, event: PAUSED_ABI,     fromBlock: block.number, toBlock: block.number }),
          publicClient.getLogs({ address: config.vaultAddress, event: RESUMED_ABI,    fromBlock: block.number, toBlock: block.number }),
        ])

        for (const l of configured) {
          store.upsertUser(l.args.user as `0x${string}`, Number(l.args.basisPoints))
          log.event(`Configured: ${l.args.user} @ ${l.args.basisPoints}bp`)
        }
        for (const l of paused)  { store.pauseUser(l.args.user  as `0x${string}`); log.event(`Paused: ${l.args.user}`) }
        for (const l of resumed) { store.resumeUser(l.args.user as `0x${string}`); log.event(`Resumed: ${l.args.user}`) }

      } catch (err: unknown) {
        log.error(`vaultEvents block ${block.number}: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    onError: (err) => log.error('watchBlocks[vault]:', err.message),
  })
}