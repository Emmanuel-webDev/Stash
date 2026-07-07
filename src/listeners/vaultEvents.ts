import { parseAbiItem, getAddress, type PublicClient } from 'viem'
import { config } from '../config.js'
import { store } from '../db/store.js'
import { log } from '../utils/logger.js'

// Single ABI definition used for both watchContractEvent and getLogs
const CONFIGURED_ABI = parseAbiItem('event Configured(address indexed user, uint256 basisPoints)')
const PAUSED_ABI     = parseAbiItem('event ListeningPaused(address indexed user)')
const RESUMED_ABI    = parseAbiItem('event ListeningResumed(address indexed user)')

const CHUNK_SIZE = 9_000n

// ── Helpers ───────────────────────────────────────────────────────────────────
function applyConfigured(user: string, basisPoints: bigint | number, prefix: string): void {
  store.upsertUser(getAddress(user), Number(basisPoints))
  log.event(`${prefix} Configured: ${user} @ ${basisPoints}bp`)
}

function applyPaused(user: string, prefix: string): void {
  store.pauseUser(getAddress(user))
  log.event(`${prefix} Paused: ${user}`)
}

function applyResumed(user: string, prefix: string): void {
  store.resumeUser(getAddress(user))
  log.event(`${prefix} Resumed: ${user}`)
}

// ── Live vault lifecycle listener ─────────────────────────────────────────────
// Started BEFORE backfill — catches any Configured/Paused/Resumed events
// that fire while the backfill is running. upsertUser is idempotent so
// if backfill later processes the same event, it safely overwrites.
function startVaultLifecycleListener(publicClient: PublicClient): void {
  log.info(`Live vault lifecycle listener active @ ${config.vaultAddress}`)

  publicClient.watchContractEvent({
    address  : getAddress(config.vaultAddress),
    abi      : [CONFIGURED_ABI],
    eventName: 'Configured',
    onLogs   : (logs) => {
      for (const l of logs) {
        if (!l.args.user || l.args.basisPoints === undefined) continue
        applyConfigured(l.args.user as string, l.args.basisPoints as bigint, '[Live]')
      }
    },
    onError: (err) => log.error(`vaultLifecycle[Configured]: ${err.message}`),
  })

  publicClient.watchContractEvent({
    address  : getAddress(config.vaultAddress),
    abi      : [PAUSED_ABI],
    eventName: 'ListeningPaused',
    onLogs   : (logs) => {
      for (const l of logs) {
        if (!l.args.user) continue
        applyPaused(l.args.user as string, '[Live]')
      }
    },
    onError: (err) => log.error(`vaultLifecycle[Paused]: ${err.message}`),
  })

  publicClient.watchContractEvent({
    address  : getAddress(config.vaultAddress),
    abi      : [RESUMED_ABI],
    eventName: 'ListeningResumed',
    onLogs   : (logs) => {
      for (const l of logs) {
        if (!l.args.user) continue
        applyResumed(l.args.user as string, '[Live]')
      }
    },
    onError: (err) => log.error(`vaultLifecycle[Resumed]: ${err.message}`),
  })
}

// ── Backfill — fetches all historical events in 9,000-block chunks ────────────
async function backfill(
  publicClient: PublicClient,
  fromBlock   : bigint,
  toBlock     : bigint,
): Promise<void> {
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
      applyConfigured(l.args.user as string, l.args.basisPoints as bigint, '[Backfill]')
      totalConfigured++
    }
    for (const l of paused)  applyPaused(l.args.user   as string, '[Backfill]')
    for (const l of resumed) applyResumed(l.args.user  as string, '[Backfill]')
  }

  log.ok(`Backfill done — ${totalConfigured} users loaded`)
}

// ── Entry point ───────────────────────────────────────────────────────────────
export async function startVaultEventListeners(publicClient: PublicClient): Promise<void> {
  log.info(`Watching vault @ ${config.vaultAddress}`)

  // 1. Live listener starts first — no events missed during backfill
  startVaultLifecycleListener(publicClient)

  // 2. Backfill all history from vault deploy block to now
  const currentBlock = await publicClient.getBlockNumber()
  await backfill(publicClient, config.vaultDeployBlock, currentBlock)
}