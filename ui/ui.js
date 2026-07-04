// ═══════════════════════════════════════════════
// ui.js — DOM helpers and UI state management
// ═══════════════════════════════════════════════

// ── Element refs ─────────────────────────────────────────────────────────────
export const el = {
  landing       : document.getElementById('landing'),
  dashboard     : document.getElementById('dashboard'),
  connectBtn    : document.getElementById('connectBtn'),
  connectLanding: document.getElementById('connectLanding'),
  disconnectBtn : document.getElementById('disconnectBtn'),
  walletDisplay : document.getElementById('walletDisplay'),
  balanceDisplay: document.getElementById('balanceDisplay'),
  rateDisplay   : document.getElementById('rateDisplay'),
  rateValue     : document.getElementById('rateValue'),
  volumeDisplay : document.getElementById('volumeDisplay'),
  eventsDisplay : document.getElementById('eventsDisplay'),
  statusBar     : document.getElementById('statusBar'),
  statusText    : document.getElementById('statusText'),
  rateSlider    : document.getElementById('rateSlider'),
  configureBtn  : document.getElementById('configureBtn'),
  pauseBtn      : document.getElementById('pauseBtn'),
  resumeBtn     : document.getElementById('resumeBtn'),
  withdrawBtn   : document.getElementById('withdrawBtn'),
  feed          : document.getElementById('feed'),
  feedEmpty     : document.getElementById('feedEmpty'),
  projection    : document.getElementById('projection'),
  modal         : document.getElementById('modal'),
  modalTitle    : document.getElementById('modalTitle'),
  modalDesc     : document.getElementById('modalDesc'),
  modalHash     : document.getElementById('modalHash'),
  modalSpinner  : document.getElementById('modalSpinner'),
  modalClose    : document.getElementById('modalClose'),
  toast         : document.getElementById('toast'),
}

// ── Formatters ────────────────────────────────────────────────────────────────

/** Format a 6-decimal USDC bigint to a readable string */
export function formatUSDC(amount) {
  return (Number(amount) / 1e6).toFixed(2)
}

/** Shorten an address for display */
export function shortAddr(addr) {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer = null

export function showToast(message, duration = 3500) {
  clearTimeout(toastTimer)
  el.toast.textContent = message
  el.toast.classList.add('toast--show')
  toastTimer = setTimeout(() => el.toast.classList.remove('toast--show'), duration)
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function openModal(title, desc) {
  el.modalTitle.textContent      = title
  el.modalDesc.textContent       = desc
  el.modalHash.textContent       = ''
  el.modalSpinner.hidden         = false
  el.modalClose.hidden           = true
  el.modal.setAttribute('aria-hidden', 'false')
  el.modal.classList.add('modal-overlay--open')
}

export function updateModal(title, desc, txHash = '') {
  el.modalTitle.textContent = title
  el.modalDesc.textContent  = desc
  el.modalHash.textContent  = txHash ? `Tx: ${txHash}` : ''
  el.modalSpinner.hidden    = true
  el.modalClose.hidden      = false
}

export function closeModal() {
  el.modal.setAttribute('aria-hidden', 'true')
  el.modal.classList.remove('modal-overlay--open')
}

// ── Status bar ────────────────────────────────────────────────────────────────
export function setStatus(message, state = 'inactive') {
  el.statusBar.dataset.state = state
  el.statusText.textContent  = message
}

// ── Slider & rate display ─────────────────────────────────────────────────────
export function updateRateUI(value) {
  const pct = ((value - 1) / 19) * 100
  document.documentElement.style.setProperty('--slider-pct', pct + '%')
  el.rateValue.textContent = value
  el.rateSlider.value      = value

  const est = ((value / 100) * 500).toFixed(2)
  el.projection.innerHTML = `Spend $500/month → save <strong>$${est}</strong>`

  document.querySelectorAll('.preset').forEach(btn => {
    btn.classList.toggle('preset--active', parseInt(btn.dataset.value) === parseInt(value))
  })
}

// ── Activity feed ─────────────────────────────────────────────────────────────
const FEED_ICONS = {
  save    : { icon: '↓', cls: 'feed-icon--save'     },
  withdraw: { icon: '↑', cls: 'feed-icon--withdraw' },
  pause   : { icon: '⏸', cls: 'feed-icon--pause'   },
  resume  : { icon: '▶', cls: 'feed-icon--config'   },
  config  : { icon: '⚙', cls: 'feed-icon--config'   },
}

export function addFeedItem({ title, meta, amount, type = 'save' }) {
  el.feedEmpty.hidden = true

  const { icon, cls } = FEED_ICONS[type] || FEED_ICONS.save
  const amountClass = type === 'save' ? 'feed-amount--green'
                    : type === 'withdraw' ? 'feed-amount--red'
                    : ''

  const item = document.createElement('div')
  item.className  = 'feed-item'
  item.setAttribute('role', 'listitem')
  item.innerHTML  = `
    <div class="feed-left">
      <div class="feed-icon ${cls}" aria-hidden="true">${icon}</div>
      <div>
        <p class="feed-title">${title}</p>
        <p class="feed-meta">${meta}</p>
      </div>
    </div>
    ${amount ? `<span class="feed-amount ${amountClass}">${amount}</span>` : ''}
  `

  el.feed.prepend(item)
}

// ── Dashboard visibility ──────────────────────────────────────────────────────
export function showDashboard(addr) {
  el.landing.hidden        = true
  el.dashboard.hidden      = false
  el.connectBtn.hidden     = true
  el.connectLanding.hidden = true
  el.disconnectBtn.hidden  = false
  el.walletDisplay.hidden  = false
  el.walletDisplay.textContent = shortAddr(addr)
}

export function showLanding() {
  el.landing.hidden        = false
  el.dashboard.hidden      = true
  el.connectBtn.hidden     = false
  el.connectLanding.hidden = false
  el.disconnectBtn.hidden  = true
  el.walletDisplay.hidden  = true
}

// ── Balance display ───────────────────────────────────────────────────────────
export function updateBalance(balance6) {
  el.balanceDisplay.textContent = formatUSDC(balance6)
  el.withdrawBtn.disabled       = balance6 === 0n
}
