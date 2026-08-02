import { parseAbiItem, getAddress, decodeEventLog, encodeEventTopics, type PublicClient, type Log } from 'viem'
import { config } from '../config.js'
import { store } from '../db/store.js'
import { log } from '../utils/logger.js'
import { watchLogsPolling } from '../utils/watchLogs.js'

// Single ABI definition used for both watchContractEvent and getLogs
const CONFIGURED_ABI = parseAbiItem('event Configured(address indexed user, uint256 basisPoints)')
const PAUSED_ABI     = parseAbiItem('event ListeningPaused(address indexed user)')
const RESUMED_ABI    = parseAbiItem('event ListeningResumed(address indexed user)')

const VAULT_EVENTS = [CONFIGURED_ABI, PAUSED_ABI, RESUMED_ABI] as const

// Arc's public RPC rate-limits aggressively (429 "request limit reached") — fetching
// each event type separately multiplies request volume for no benefit. Instead we
// fetch ALL logs for the vault address in one call and dispatch by topic0 locally.
const TOPIC_TO_EVENT = new Map(
  VAULT_EVENTS.map((event) => [encodeEventTopics({ abi: [event], eventName: event.name })[0], event]),
)

const CHUNK_SIZE        = 9_000n
const LIVE_POLL_INTERVAL = 4_000
const CHUNK_DELAY_MS     = 200

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

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// Dispatches one raw (undecoded) log to the right handler based on its topic0.
// Returns true if it incremented the "Configured" counter, for backfill stats.
function dispatchLog(l: Log, prefix: string): boolean {
  const topic0 = l.topics[0]
  const matched = topic0 ? TOPIC_TO_EVENT.get(topic0) : undefined
  if (!matched) return false

  try {
    const { eventName, args } = decodeEventLog({ abi: [matched], data: l.data, topics: l.topics }) as {
      eventName: 'Configured' | 'ListeningPaused' | 'ListeningResumed'
      args: { user?: string; basisPoints?: bigint }
    }
    if (eventName === 'Configured' && args.user && args.basisPoints !== undefined) {
      applyConfigured(args.user, args.basisPoints, prefix)
      return true
    }
    if (eventName === 'ListeningPaused' && args.user) {
      applyPaused(args.user, prefix)
    } else if (eventName === 'ListeningResumed' && args.user) {
      applyResumed(args.user, prefix)
    }
  } catch {
    // Not one of our vault lifecycle events (or malformed) — ignore
  }
  return false
}

// ── Live vault lifecycle listener ─────────────────────────────────────────────
// Started BEFORE backfill — catches any Configured/Paused/Resumed events
// that fire while the backfill is running. upsertUser is idempotent so
// if backfill later processes the same event, it safely overwrites.
//
// Fetches all vault logs in a single unfiltered getLogs call per tick (instead of
// one call per event type) to stay well under Arc's public RPC rate limit.
function startVaultLifecycleListener(publicClient: PublicClient): void {
  log.info(`Live vault lifecycle listener active @ ${config.vaultAddress}`)

  watchLogsPolling({
    client         : publicClient,
    address        : getAddress(config.vaultAddress),
    pollingInterval: LIVE_POLL_INTERVAL,
    onLogs         : (logs) => {
      for (const l of logs) dispatchLog(l, '[Live]')
    },
    onError: (err) => log.error(`vaultLifecycle: ${err.message}`),
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

    const logs = await publicClient.getLogs({ address: config.vaultAddress, fromBlock: from, toBlock: to })
    for (const l of logs) {
      if (dispatchLog(l, '[Backfill]')) totalConfigured++
    }

    // Small gap between chunks — avoids bursting Arc's public RPC rate limit
    if (to < toBlock) await wait(CHUNK_DELAY_MS)
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