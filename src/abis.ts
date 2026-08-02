// Only the ABI fragment the relayer needs — no full ABI overhead

// depositFor — the one write the relayer submits directly as a transaction
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
