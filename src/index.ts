import 'dotenv/config'
import { store } from './db/store.js'
import { publicClient, relayerAccount } from './utils/clients.js'
import { startVaultEventListeners } from './listeners/vaultEvents.js'
import { startTransferListener } from './listeners/transferEvents.js'
import { startServer } from './server.js'
import { log } from './utils/logger.js'
import { config, arcChain } from './config.js'

async function main(): Promise<void> {
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  log.info('  SavingsVault Relayer — Arc Mainnet')
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  log.info(`Vault:   ${config.vaultAddress}`)
  log.info(`USDC:    ${config.usdcAddress}`)
  log.info(`Relayer: ${relayerAccount.address}`)

  // viem does NOT verify that ARC_RPC_HTTP actually serves the configured
  // chain — it'll happily run against the wrong network with no warning.
  // Confirmed by testing: pointing ARC_RPC_HTTP at testnet while arcChain.id
  // was set to mainnet ran without error. This check is the only thing that
  // catches a stale/mismatched .env before it starts sending real transactions.
  const actualChainId = await publicClient.getChainId()
  if (actualChainId !== arcChain.id) {
    throw new Error(
      `Chain ID mismatch: ARC_RPC_HTTP reports chain ${actualChainId}, ` +
      `but this build is configured for chain ${arcChain.id} (${arcChain.name}). ` +
      `Check ARC_RPC_HTTP in .env.`
    )
  }

  // Serves the dashboard + /health — required for Render's free "Web Service" tier
  startServer()

  // Backfill all historical vault events + start watching new blocks
  await startVaultEventListeners(publicClient)

  const activeUsers = store.getAllActive()
  log.info(`Active users in DB: ${activeUsers.length}`)
  for (const u of activeUsers) {
    log.info(`  ${u.address} @ ${u.basis_points}bp`)
  }

  // Start watching USDC transfers
  startTransferListener(publicClient)

  log.ok('Relayer live — listening for events...')
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  process.on('SIGINT',  () => { log.info('Shutting down...'); process.exit(0) })
  process.on('SIGTERM', () => { log.info('Shutting down...'); process.exit(0) })
}

main().catch((err) => {
  log.error('Fatal:', err)
  process.exit(1)
})