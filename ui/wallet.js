// ═══════════════════════════════════════════════
// wallet.js — MetaMask connection and network
// ═══════════════════════════════════════════════

import { ARC_CHAIN_ID, ARC_RPC, ARC_EXPLORER } from './config.js'
import { loadViem, createPublicClient } from './chain.js'
import { showToast, friendlyError } from './ui.js'

let _account      = null
let _publicClient = null
let _viem         = null

// ── Getters ───────────────────────────────────────────────────────────────────
export const getAccount      = () => _account
export const getPublicClient = () => _publicClient
export const getViem         = () => _viem

// ── Connect ───────────────────────────────────────────────────────────────────
export async function connectWallet() {
  if (!window.ethereum) {
    showToast('No wallet found. Please install MetaMask.')
    return null
  }

  try {
    _viem = await loadViem()

    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
    _account = accounts[0]

    await switchToArc()

    _publicClient = createPublicClient(_viem)

    return _account
  } catch (err) {
    showToast('Connection failed: ' + friendlyError(err))
    return null
  }
}

// ── Disconnect ────────────────────────────────────────────────────────────────
export function disconnectWallet() {
  _account      = null
  _publicClient = null
}

// ── Network switching ─────────────────────────────────────────────────────────
async function switchToArc() {
  const chainHex = '0x' + ARC_CHAIN_ID.toString(16)

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainHex }],
    })
  } catch (err) {
    // Chain not added yet — add it
    if (err.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId          : chainHex,
          chainName        : 'Arc Testnet',
          nativeCurrency   : { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
          rpcUrls          : [ARC_RPC],
          blockExplorerUrls: [ARC_EXPLORER],
        }],
      })
    } else {
      throw err
    }
  }
}

// ── Send transaction helper ───────────────────────────────────────────────────
export async function sendTx({ to, data }) {
  return window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{ from: _account, to, data }],
  })
}
