// Only the ABI fragment the relayer needs — no full ABI overhead

// depositFor — the one write the relayer submits directly as a transaction.
// Takes the observed spend, not a pre-computed savings figure — the contract
// computes the savings amount itself from the user's on-chain basisPoints.
export const VAULT_ABI = [
  {
    name: 'depositFor',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'user',        type: 'address' },
      { name: 'spendAmount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const
