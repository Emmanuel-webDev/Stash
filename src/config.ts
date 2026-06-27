import 'dotenv/config'
import { defineChain } from 'viem'

function e(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`Missing env var: ${key}`)
  return v
}

export const arcTestnet = defineChain({
  id      : 5042002,
  name    : 'Arc Testnet',
  network : 'arc-testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
  rpcUrls: {
    default: { http: [e('ARC_RPC_HTTP')], webSocket: [e('ARC_RPC_WSS')] },
    public:  { http: [e('ARC_RPC_HTTP')], webSocket: [e('ARC_RPC_WSS')] },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' },
  },
  testnet: true,
})

export const config = {
  relayerPrivateKey : e('RELAYER_PRIVATE_KEY') as `0x${string}`,
  vaultAddress      : e('VAULT_ADDRESS')        as `0x${string}`,
  usdcAddress       : (process.env.USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000') as `0x${string}`,
  // The block your vault was deployed at — find it on https://testnet.arcscan.app
  // Prevents scanning 48M+ blocks from genesis during backfill
  vaultDeployBlock  : BigInt(process.env.VAULT_DEPLOY_BLOCK ?? '0'),
} as const