/**
 * Arc's public testnet RPC doesn't reliably persist eth_newFilter state across
 * requests (likely load-balanced across backend nodes), which makes viem's
 * default watchContractEvent (filter + eth_getFilterChanges) fail with
 * "filter not found". This polls eth_getLogs over block ranges instead —
 * stateless, so it works with any RPC regardless of filter support.
 */
import type { Address, Log, PublicClient } from 'viem'
import type { AbiEvent } from 'abitype'
import { log as logger } from './logger.js'

interface WatchLogsParams {
  client          : PublicClient
  address         : Address
  /** Omit to fetch all logs for the address in one call (caller decodes by topic0) */
  event?          : AbiEvent
  pollingInterval?: number
  onLogs          : (logs: Log[]) => void
  onError?        : (err: Error) => void
}

export function watchLogsPolling({
  client,
  address,
  event,
  pollingInterval = client.pollingInterval,
  onLogs,
  onError,
}: WatchLogsParams): () => void {
  let stopped   = false
  let lastBlock : bigint | undefined
  let inFlight  = false

  const tick = async (): Promise<void> => {
    if (stopped || inFlight) return
    inFlight = true
    try {
      const currentBlock = await client.getBlockNumber()

      if (lastBlock === undefined) {
        lastBlock = currentBlock
        return
      }

      if (currentBlock > lastBlock) {
        const logs = await client.getLogs({
          address,
          ...(event ? { event } : {}),
          fromBlock: lastBlock + 1n,
          toBlock  : currentBlock,
        })
        lastBlock = currentBlock
        if (logs.length > 0) onLogs(logs)
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      if (onError) onError(e)
      else logger.error('watchLogsPolling:', e.message)
    } finally {
      inFlight = false
    }
  }

  void tick()
  const interval = setInterval(tick, pollingInterval)

  return () => {
    stopped = true
    clearInterval(interval)
  }
}
