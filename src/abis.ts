// Only the ABI fragments the relayer needs — no full ABI overhead

export const TRANSFER_EVENT = {
  type: 'event', name: 'Transfer',
  inputs: [
    { name: 'from',  type: 'address', indexed: true  },
    { name: 'to',    type: 'address', indexed: true  },
    { name: 'value', type: 'uint256', indexed: false },
  ],
} as const

export const CONFIGURED_EVENT = {
  type: 'event', name: 'Configured',
  inputs: [
    { name: 'user',        type: 'address', indexed: true  },
    { name: 'basisPoints', type: 'uint256', indexed: false },
  ],
} as const

export const LISTENING_PAUSED_EVENT = {
  type: 'event', name: 'ListeningPaused',
  inputs: [{ name: 'user', type: 'address', indexed: true }],
} as const

export const LISTENING_RESUMED_EVENT = {
  type: 'event', name: 'ListeningResumed',
  inputs: [{ name: 'user', type: 'address', indexed: true }],
} as const

// depositFor — the one write the relayer submits as a UserOperation
export const VAULT_ABI = [
  {
    name: 'depositFor',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'user',   type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const
