// ═══════════════════════════════════════════════
// chain.js — Viem client and Arc chain definition
// ═══════════════════════════════════════════════

import { ARC_CHAIN_ID, ARC_RPC, ARC_EXPLORER } from './config.js'

let viem = null

/** Lazy-load viem from CDN — called once at wallet connect */
export async function loadViem() {
  if (viem) return viem
  viem = await import('https://esm.sh/viem@2.21.0')
  return viem
}

/** Arc Testnet chain definition for viem */
function getArcChain(viemInstance) {
  return viemInstance.defineChain({
    id     : ARC_CHAIN_ID,
    name   : 'Arc Testnet',
    network: 'arc-testnet',
    nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
    rpcUrls: {
      default: { http: [ARC_RPC] },
      public : { http: [ARC_RPC] },
    },
    blockExplorers: {
      default: { name: 'ArcScan', url: ARC_EXPLORER },
    },
    testnet: true,
  })
}

/** Create a read-only public client for Arc */
export function createPublicClient(viemInstance) {
  return viemInstance.createPublicClient({
    chain    : getArcChain(viemInstance),
    transport: viemInstance.http(ARC_RPC, {
      retryCount: 3,
      retryDelay: 1_000,
      timeout   : 15_000,
    }),
  })
}
