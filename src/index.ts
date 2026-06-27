import 'dotenv/config'
import { store } from './db/store.js'
import { publicClient, relayerAccount } from './utils/clients.js'
import { startVaultEventListeners } from './listeners/vaultEvents.js'
import { startTransferListener } from './listeners/transferEvents.js'
import { log } from './utils/logger.js'
import { config } from './config.js'

async function main(): Promise<void> {
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  log.info('  SavingsVault Relayer — Arc Testnet')
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  log.info(`Vault:   ${config.vaultAddress}`)
  log.info(`USDC:    ${config.usdcAddress}`)
  log.info(`Relayer: ${relayerAccount.address}`)

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