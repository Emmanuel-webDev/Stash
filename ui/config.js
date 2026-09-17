// ═══════════════════════════════════════════════
// config.js — App-wide constants
// ═══════════════════════════════════════════════

export const VAULT_ADDRESS = "0x1AFE5a4402DFe72e4a7Ab3016952F71DcC119C79";
export const USDC_ADDRESS   = '0x3600000000000000000000000000000000000000'
export const ARC_CHAIN_ID   = 5042
// Circle's official endpoint (docs.arc.io).
export const ARC_RPC        = 'https://rpc.mainnet.arc.io'
// Third-party fallback — automatically used if the primary throttles/drops a
// request (Arc's public mainnet RPC rate-limits aggressively; see chain.js).
export const ARC_RPC_FALLBACK = 'https://rpc.arc-scan.org'
export const ARC_EXPLORER   = 'https://explorer.arc.io'
export const VAULT_DEPLOY_BLOCK = 21350919n;

export const VAULT_ABI = [
  { name: 'configure',        type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'basisPoints',  type: 'uint256' }], outputs: [] },
  { name: 'pauseListening',   type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { name: 'resumeListening',  type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { name: 'withdraw',         type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'balanceOf',        type: 'function', stateMutability: 'view',       inputs: [{ name: 'user',   type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'userConfig',       type: 'function', stateMutability: 'view',       inputs: [{ name: 'user',   type: 'address' }], outputs: [
    { name: 'basisPoints',    type: 'uint256' },
    { name: 'active',         type: 'bool'    },
    { name: 'listeningPaused',type: 'bool'    },
    { name: 'balance',        type: 'uint256' },
  ]},
  { name: 'Deposited',        type: 'event', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }, { name: 'totalBalance', type: 'uint256', indexed: false }] },
  { name: 'Withdrawn',        type: 'event', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }, { name: 'remainingBalance', type: 'uint256', indexed: false }] },
  { name: 'Configured',       type: 'event', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'basisPoints', type: 'uint256', indexed: false }] },
  { name: 'ListeningPaused',  type: 'event', inputs: [{ name: 'user', type: 'address', indexed: true }] },
  { name: 'ListeningResumed', type: 'event', inputs: [{ name: 'user', type: 'address', indexed: true }] },
]

export const USDC_ABI = [
  { name: 'approve',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view',       inputs: [{ name: 'owner',   type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
]

// Bounded approval instead of unlimited (MAX_UINT256). Caps how much a
// compromised relayer key or vault bug could ever pull in one shot — the UI
// silently re-prompts for a fresh approval once the remaining allowance
// drops below the threshold, so this never asks more often than necessary.
export const APPROVAL_TOPUP_USDC         = 500_000_000n // 500 USDC (6-decimal ERC-20 units)
export const APPROVAL_LOW_THRESHOLD_USDC = 50_000_000n  // re-prompt once allowance drops below 50 USDC
