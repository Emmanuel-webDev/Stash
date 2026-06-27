/**
 * index.ts — SavingsVault Relayer
 *
 * Startup sequence:
 *  1. Build smart account client (derives ERC-4337 smart account from relayer key)
 *  2. Log smart account address — this is what needs USDC funded for gas
 *  3. Start vault event listeners (keeps registered_users DB in sync)
 *  4. Start USDC transfer listener (hot path — triggers deposits)
 */

import 'dotenv/config'
import { store } from './db/store.js'
import { publicClient, buildSmartAccountClient } from './utils/clients.js'
import { startVaultEventListeners } from './listeners/vaultEvents.js'
import { startTransferListener } from './listeners/transferEvents.js'
import { log } from './utils/logger.js'
import { config } from './config.js'

async function main(): Promise<void> {
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  log.info('  SavingsVault Relayer — Arc Testnet')
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  log.info(`Vault:  ${config.vaultAddress}`)
  log.info(`USDC:   ${config.usdcAddress}`)

  // ── Build smart account (async — needs on-chain nonce lookup) ─────────────
  const { smartAccountClient, smartAccountAddress } = await buildSmartAccountClient()

  log.info(`Smart account (relayer): ${smartAccountAddress}`)
  log.warn(`Fund this address with testnet USDC for gas → https://faucet.circle.com`)

  // ── Show active users at startup ──────────────────────────────────────────
  const activeUsers = store.getAllActive()
  log.info(`Active users in DB: ${activeUsers.length}`)
  for (const u of activeUsers) {
    log.info(`  ${u.address} @ ${u.basis_points}bp`)
  }

  // ── Start listeners ───────────────────────────────────────────────────────
  // Vault events first — so any Configured() that fires before Transfer
  // listener is up doesn't get missed (both subscribe simultaneously in practice)
  startVaultEventListeners(publicClient)
  startTransferListener(publicClient, smartAccountClient)

  log.ok('Relayer live — listening for events...')
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // Keep process alive — watchEvent handles its own reconnection
  process.on('SIGINT',  () => { log.info('Shutting down...'); process.exit(0) })
  process.on('SIGTERM', () => { log.info('Shutting down...'); process.exit(0) })
}

main().catch((err) => {
  log.error('Fatal:', err)
  process.exit(1)
})
