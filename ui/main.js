// ═══════════════════════════════════════════════
// main.js — Entry point
// Wires UI events to wallet + vault modules
// ═══════════════════════════════════════════════

import { el, showDashboard, showLanding, updateRateUI, closeModal } from './ui.js'
import { connectWallet, disconnectWallet } from './wallet.js'
import { loadUserState, stopEventWatcher, configure, pauseListening, resumeListening, withdraw } from './vault.js'

// ── Init ──────────────────────────────────────────────────────────────────────
updateRateUI(5)

// ── Connect ───────────────────────────────────────────────────────────────────
async function handleConnect() {
  const account = await connectWallet()
  if (!account) return

  showDashboard(account)
  await loadUserState()
}

el.connectBtn.addEventListener('click', handleConnect)
el.connectLanding.addEventListener('click', handleConnect)

// ── Disconnect ────────────────────────────────────────────────────────────────
el.disconnectBtn.addEventListener('click', () => {
  stopEventWatcher()
  disconnectWallet()
  showLanding()
})

// ── Slider ────────────────────────────────────────────────────────────────────
el.rateSlider.addEventListener('input', e => updateRateUI(parseInt(e.target.value)))

// ── Presets ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.preset').forEach(btn => {
  btn.addEventListener('click', () => updateRateUI(parseInt(btn.dataset.value)))
})

// ── Configure ─────────────────────────────────────────────────────────────────
el.configureBtn.addEventListener('click', () => {
  const basisPoints = parseInt(el.rateSlider.value) * 100
  configure(basisPoints)
})

// ── Pause / Resume ────────────────────────────────────────────────────────────
el.pauseBtn.addEventListener('click', pauseListening)
el.resumeBtn.addEventListener('click', resumeListening)

// ── Withdraw ──────────────────────────────────────────────────────────────────
el.withdrawBtn.addEventListener('click', withdraw)

// ── Modal close ───────────────────────────────────────────────────────────────
el.modalClose.addEventListener('click', closeModal)

el.modal.addEventListener('click', e => {
  if (e.target === el.modal) closeModal()
})

// ── MetaMask account/chain events ─────────────────────────────────────────────
if (window.ethereum) {
  window.ethereum.on('accountsChanged', async accounts => {
    if (accounts.length === 0) {
      stopEventWatcher()
      disconnectWallet()
      showLanding()
    } else {
      const { connectWallet: reconnect } = await import('./wallet.js')
      const account = accounts[0]
      showDashboard(account)
      await loadUserState()
    }
  })

  window.ethereum.on('chainChanged', () => window.location.reload())
}
