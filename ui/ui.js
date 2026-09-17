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
  modalIcon     : document.getElementById('modalIcon'),
  modalClose    : document.getElementById('modalClose'),
  toast         : document.getElementById('toast'),
  approvalBanner    : document.getElementById('approvalBanner'),
  approvalBannerText: document.getElementById('approvalBannerText'),
  topUpBtn          : document.getElementById('topUpBtn'),
  missedBanner      : document.getElementById('missedBanner'),
  missedBannerText  : document.getElementById('missedBannerText'),
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

// ── Error formatting ─────────────────────────────────────────────────────────

/** Turn a raw viem/MetaMask error into a short, human-readable sentence */
export function friendlyError(err) {
  if (!err) return 'Something went wrong. Please try again.'

  const code = err.code ?? err.cause?.code
  if (code === 4001) return 'Request cancelled in wallet.'

  const raw = String(err.shortMessage || err.message || err)

  if (/user rejected/i.test(raw)) return 'Request cancelled in wallet.'
  if (/failed to fetch|network ?error|http request failed|timeout/i.test(raw)) {
    return 'Could not reach the Arc network. Check your connection and try again.'
  }
  if (/insufficient funds/i.test(raw)) return 'Insufficient USDC balance to cover this transaction.'

  const firstLine = raw.split('\n')[0].trim()
  return firstLine.length > 140 ? firstLine.slice(0, 140).trim() + '…' : firstLine
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function openModal(title, desc) {
  el.modalTitle.textContent      = title
  el.modalDesc.textContent       = desc
  el.modalHash.textContent       = ''
  el.modalSpinner.hidden         = false
  el.modalIcon.hidden            = true
  el.modalClose.hidden           = true
  el.modal.setAttribute('aria-hidden', 'false')
  el.modal.classList.add('modal-overlay--open')
}

/** state: 'success' | 'error' — controls the icon shown once the spinner resolves */
export function updateModal(title, desc, txHash = '', state = 'success') {
  el.modalTitle.textContent      = title
  el.modalDesc.textContent       = desc
  el.modalHash.textContent       = txHash ? `Tx: ${txHash}` : ''
  el.modalSpinner.hidden         = true
  el.modalIcon.hidden            = false
  el.modalIcon.dataset.state     = state
  el.modalIcon.textContent       = state === 'error' ? '✕' : '✓'
  el.modalClose.hidden           = false
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

// ── Approval banner ───────────────────────────────────────────────────────────
/** Show/hide the "approval running low" banner. remainingFormatted is a USDC string. */
export function setApprovalBanner(show, remainingFormatted) {
  el.approvalBanner.hidden = !show
  if (show) {
    el.approvalBannerText.textContent =
      `Approval running low (${remainingFormatted} USDC left) — top up to keep auto-saving.`
  }
}

// ── Missed savings banner ─────────────────────────────────────────────────────
/** Show/hide the "spends you missed" banner. totalFormatted is a USDC string. */
export function setMissedBanner(show, count, totalFormatted) {
  el.missedBanner.hidden = !show
  if (show) {
    const plural = count === 1 ? 'spend' : 'spends'
    el.missedBannerText.textContent =
      `${count} ${plural} (~${totalFormatted} USDC) couldn't be saved yet — usually because approval ran low while you were away. We'll catch these up automatically.`
  }
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
