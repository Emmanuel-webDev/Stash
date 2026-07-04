import { parseAbi, getAddress, type PublicClient } from 'viem'
import { config } from '../config.js'
import { store } from '../db/store.js'
import { log } from '../utils/logger.js'
import { executeDeposit } from '../processor/deposit.js'
import { relayerAccount } from '../utils/clients.js'

// 1. Use parseAbi for cleaner typing alignment with watchContractEvent
const APP_ABI = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)'
])

const SYSTEM_EMITTER  = getAddress('0xfffffffffffffffffffffffffffffffffffffffe')
const DECIMAL_DIVISOR = 1_000_000_000_000n

export function startTransferListener(publicClient: PublicClient): () => void {
  log.info(`Listening to Arc system emitter @ ${SYSTEM_EMITTER}`)

  const vaultAddr   = getAddress(config.vaultAddress)
  const relayerAddr = getAddress(relayerAccount.address)

  // watchContractEvent automatically tracks blocks and safely fetches logs
  const unwatch = publicClient.watchContractEvent({
    address: SYSTEM_EMITTER,
    abi: APP_ABI,
    eventName: 'Transfer',
    onLogs: async (logs) => {
      for (const l of logs) {
        if (!l.transactionHash || l.logIndex === undefined) continue

        // viem automatically decodes and strongly types l.args from the ABI
        const { from: fromArg, to: toArg, value } = l.args
        if (!fromArg || !toArg || !value || value === 0n) continue

        const from = getAddress(fromArg)
        const to   = getAddress(toArg)

        // Filter out unwanted interactions
        if (from === relayerAddr || to === vaultAddr) continue

        // Check database state
        const user = store.getActiveUser(from)
        if (!user) continue

        if (store.isLogProcessed(l.transactionHash, l.logIndex)) continue

        const normalizedValue = value / DECIMAL_DIVISOR
        if (normalizedValue === 0n) continue

        log.event(`Spend: ${from} amount=${normalizedValue} USDC tx=${l.transactionHash}`)

        // Wrap processing in its own try/catch so one bad DB write doesn't kill the loop
        try {
          await executeDeposit(
            from,
            user.basis_points,
            normalizedValue,
            l.transactionHash,
            l.logIndex,
          )
        } catch (depositErr) {
          log.error(`Failed to execute deposit for tx ${l.transactionHash}:`, depositErr)
        }
      }
    },
    onError: (err) => log.error('watchContractEvent encountered an error:', err.message),
  })

  return unwatch
}