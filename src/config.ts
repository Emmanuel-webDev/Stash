import 'dotenv/config'
import { defineChain } from 'viem'

function e(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`Missing env var: ${key}`)
  return v
}

// Verified live against Circle's official docs (docs.arc.io) and by querying
// eth_chainId/eth_blockNumber directly on both rpc.mainnet.arc.io and the
// third-party rpc.arc-scan.org — both return chain 5042 at matching block heights.
export const arcChain = defineChain({
  id      : 5042,
  name    : 'Arc',
  network : 'arc',
  // Arc's native interface (gas, native sends, msg.value) uses 18 decimals;
  // the separate USDC ERC-20 interface (app-level transfers/approvals) uses 6.
  // Same asset, two views, 1e12 apart — see src/listeners/transferEvents.ts.
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    // Only HTTP is used anywhere in this app (see utils/watchLogs.ts for why —
    // Arc's public RPC doesn't reliably hold eth_newFilter state). Arc mainnet
    // has no free public WSS endpoint (only paid providers with API keys), so
    // WSS is intentionally omitted rather than required.
    default: { http: [e('ARC_RPC_HTTP')] },
    public:  { http: [e('ARC_RPC_HTTP')] },
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' },
  },
  testnet: false,
})

export const config = {
  relayerPrivateKey : e('RELAYER_PRIVATE_KEY') as `0x${string}`,
  vaultAddress      : e('VAULT_ADDRESS')        as `0x${string}`,
  usdcAddress       : (process.env.USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000') as `0x${string}`,
  // The block your vault was deployed at — find it on https://explorer.arc.io
  // Prevents scanning the whole chain from genesis during backfill
  vaultDeployBlock  : BigInt(process.env.VAULT_DEPLOY_BLOCK ?? '0'),
} as const
