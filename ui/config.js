// ═══════════════════════════════════════════════
// config.js — App-wide constants
// ═══════════════════════════════════════════════

export const VAULT_ADDRESS = "0xad114a8B963F1AD5583a24d4013ce4bBbdA34275";
export const USDC_ADDRESS   = '0x3600000000000000000000000000000000000000'
export const ARC_CHAIN_ID   = 5042
// Circle's official endpoint (docs.arc.io). rpc.arc-scan.org also works as a fallback.
export const ARC_RPC        = 'https://rpc.mainnet.arc.io'
export const ARC_EXPLORER   = 'https://explorer.arc.io'
export const VAULT_DEPLOY_BLOCK = 21343272n;

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

export const MAX_UINT256 = 115792089237316195423570985008687907853269984665640564039457584007913129639935n
