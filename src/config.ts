import 'dotenv/config'
import { defineChain } from 'viem'

// ── Arc Testnet definition ────────────────────────────────────────────────────
// Chain ID 5042002 confirmed: https://chainlist.org/chain/5042002
// USDC is the native gas token (6 decimals — NOT 18 like ETH chains)
export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  // USDC as native currency — this is what pays for gas, not ETH
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
  rpcUrls: {
    default: {
      http:      [e('ARC_RPC_HTTP')],
      webSocket: [e('ARC_RPC_WSS')],
    },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' },
  },
  testnet: true,
})

function e(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`Missing env var: ${key}`)
  return v
}

export const config = {
  relayerPrivateKey : e('RELAYER_PRIVATE_KEY') as `0x${string}`,
  pimlicoApiKey     : e('PIMLICO_API_KEY'),
  vaultAddress      : e('VAULT_ADDRESS')       as `0x${string}`,
  // Arc system USDC address — this is the native gas token contract
  usdcAddress       : (process.env.USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000') as `0x${string}`,

  // Pimlico Arc testnet bundler + paymaster endpoint
  // Slug "arc-testnet" confirmed in Pimlico's supported chains list
  get pimlicoUrl() {
    return `https://api.pimlico.io/v2/arc-testnet/rpc?apikey=${this.pimlicoApiKey}`
  },
} as const
