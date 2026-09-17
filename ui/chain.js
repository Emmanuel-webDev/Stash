// ═══════════════════════════════════════════════
// chain.js — Viem client and Arc chain definition
// ═══════════════════════════════════════════════

import { ARC_CHAIN_ID, ARC_RPC, ARC_RPC_FALLBACK, ARC_EXPLORER } from './config.js'

let viem = null

/** Lazy-load viem from CDN — called once at wallet connect */
export async function loadViem() {
  if (viem) return viem
  viem = await import('https://esm.sh/viem@2.21.0')
  return viem
}

/** Arc chain definition for viem */
function getArcChain(viemInstance) {
  return viemInstance.defineChain({
    id     : ARC_CHAIN_ID,
    name   : 'Arc',
    network: 'arc',
    // Native interface (gas/msg.value) uses 18 decimals; the USDC ERC-20
    // interface used for balances/transfers uses 6 — same asset, two views.
    nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
    rpcUrls: {
      default: { http: [ARC_RPC] },
      public : { http: [ARC_RPC, ARC_RPC_FALLBACK] },
    },
    blockExplorers: {
      default: { name: 'Arc Explorer', url: ARC_EXPLORER },
    },
    testnet: false,
  })
}

/**
 * Create a read-only public client for Arc, with automatic failover to
 * ARC_RPC_FALLBACK. Arc's public mainnet RPC rate-limits aggressively (and
 * is brand new), so a request that fails on the primary after its own
 * retries is retried against the fallback before surfacing an error.
 */
export function createPublicClient(viemInstance) {
  const transportOpts = { retryCount: 2, retryDelay: 750, timeout: 15_000 }
  return viemInstance.createPublicClient({
    chain    : getArcChain(viemInstance),
    transport: viemInstance.fallback([
      viemInstance.http(ARC_RPC, transportOpts),
      viemInstance.http(ARC_RPC_FALLBACK, transportOpts),
    ]),
  })
}
