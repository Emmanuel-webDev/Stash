import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet, config } from '../config.js'

export const relayerAccount = privateKeyToAccount(config.relayerPrivateKey)

export const publicClient = createPublicClient({
  chain           : arcTestnet,
  transport       : http(arcTestnet.rpcUrls.default.http[0], {
    retryCount : 5,
    retryDelay : 1_000,
    timeout    : 15_000,
  }),
  // Arc's public RPC rate-limits aggressively (429 "request limit reached") —
  // keep this conservative. Live listeners poll at this rate by default.
  pollingInterval : 3_000,
})

export const walletClient = createWalletClient({
  account   : relayerAccount,
  chain     : arcTestnet,
  transport : http(arcTestnet.rpcUrls.default.http[0], {
    retryCount : 3,
    retryDelay : 1_000,
    timeout    : 15_000,
  }),
})