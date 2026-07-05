// ═══════════════════════════════════════════════
// vault.js — Vault contract interactions
// ═══════════════════════════════════════════════

import { VAULT_ADDRESS, USDC_ADDRESS, VAULT_ABI, USDC_ABI, MAX_UINT256, VAULT_DEPLOY_BLOCK } from './config.js'
import { getAccount, getPublicClient, getViem, sendTx } from './wallet.js'
import { addFeedItem, setStatus, updateBalance, formatUSDC, el } from './ui.js'
import { showToast, openModal, updateModal } from './ui.js'

// Arc RPC limit is 10,000 blocks per getLogs call — chunk to stay under it
const CHUNK_SIZE = 9_000n

let stopWatcher = null

// ── Read: load full user state from vault ─────────────────────────────────────
export async function loadUserState() {
  const account      = getAccount()
  const publicClient = getPublicClient()

  try {
    const cfg = await publicClient.readContract({
      address     : VAULT_ADDRESS,
      abi         : VAULT_ABI,
      functionName: 'userConfig',
      args        : [account],
    })

    const basisPoints      = cfg[0]
    const active           = cfg[1]
    const listeningPaused  = cfg[2]
    const balance          = cfg[3]

    updateBalance(balance)

    if (active) {
      const pct = Number(basisPoints) / 100
      el.rateDisplay.textContent  = pct + '%'
      el.rateValue.textContent    = pct
      el.rateSlider.value         = pct
      el.configureBtn.textContent = 'Update Rate'
      el.pauseBtn.hidden          = listeningPaused
      el.resumeBtn.hidden         = !listeningPaused

      setStatus(
        listeningPaused
          ? 'Savings paused — resume to start catching spends.'
          : 'Active — catching all outbound USDC spends.',
        listeningPaused ? 'paused' : 'active'
      )
    } else {
      el.rateDisplay.textContent = '—'
      setStatus('Not configured. Set a rate and activate below.', 'inactive')
    }

    await loadRecentEvents()
    startEventWatcher()

  } catch (err) {
    console.error('loadUserState:', err)
    setStatus('Could not load vault state.', 'inactive')
  }
}

// ── Read: backfill ALL events from vault deploy block ─────────────────────────
// Fetches in 9,000-block chunks to stay under Arc's 10,000 block RPC limit.
// Stats computed entirely from on-chain data — accurate on any device.
async function loadRecentEvents() {
  const account      = getAccount()
  const publicClient = getPublicClient()

  const depositedEvent    = VAULT_ABI.find(e => e.name === 'Deposited')
  const withdrawnEvent    = VAULT_ABI.find(e => e.name === 'Withdrawn')
  const configuredEvent   = VAULT_ABI.find(e => e.name === 'Configured')
  const pausedEvent       = VAULT_ABI.find(e => e.name === 'ListeningPaused')
  const resumedEvent      = VAULT_ABI.find(e => e.name === 'ListeningResumed')

  const allDeposits    = []
  const allWithdrawals = []
  const allConfigs     = []
  const allPauses      = []
  const allResumes     = []

  try {
    const currentBlock = await publicClient.getBlockNumber()

    // Chunk through all blocks from vault deploy to now
    for (let from = VAULT_DEPLOY_BLOCK; from <= currentBlock; from += CHUNK_SIZE) {
      const to = from + CHUNK_SIZE - 1n > currentBlock ? currentBlock : from + CHUNK_SIZE - 1n

      const [deposits, withdrawals, configs, pauses, resumes] = await Promise.all([
        publicClient.getLogs({ address: VAULT_ADDRESS, event: depositedEvent,  fromBlock: from, toBlock: to, args: { user: account } }),
        publicClient.getLogs({ address: VAULT_ADDRESS, event: withdrawnEvent,  fromBlock: from, toBlock: to, args: { user: account } }),
        publicClient.getLogs({ address: VAULT_ADDRESS, event: configuredEvent, fromBlock: from, toBlock: to, args: { user: account } }),
        publicClient.getLogs({ address: VAULT_ADDRESS, event: pausedEvent,     fromBlock: from, toBlock: to, args: { user: account } }),
        publicClient.getLogs({ address: VAULT_ADDRESS, event: resumedEvent,    fromBlock: from, toBlock: to, args: { user: account } }),
      ])

      allDeposits.push(...deposits)
      allWithdrawals.push(...withdrawals)
      allConfigs.push(...configs)
      allPauses.push(...pauses)
      allResumes.push(...resumes)
    }

    // Compute stats from on-chain data — source of truth on any device
    let trackedVolume = 0
    let eventCount    = 0

    for (const l of allDeposits) {
      trackedVolume += Number(l.args.amount) / 1e6
      eventCount++
    }

    el.eventsDisplay.textContent = eventCount
    el.volumeDisplay.textContent = '$' + trackedVolume.toFixed(2)

    // Build and render sorted feed (latest first, cap at 20 items)
    const all = [
      ...allDeposits.map(l    => ({ ...l, _type: 'deposit'  })),
      ...allWithdrawals.map(l => ({ ...l, _type: 'withdraw' })),
      ...allConfigs.map(l     => ({ ...l, _type: 'config'   })),
      ...allPauses.map(l      => ({ ...l, _type: 'pause'    })),
      ...allResumes.map(l     => ({ ...l, _type: 'resume'   })),
    ].sort((a, b) => Number(b.blockNumber - a.blockNumber))

    for (const l of all.slice(0, 20)) {
      _renderFeedItem(l._type, l.args, `Block ${l.blockNumber}`)
    }

  } catch (err) {
    console.error('loadRecentEvents:', err)
  }
}

// ── Live: watch for new Deposited events ──────────────────────────────────────
function startEventWatcher() {
  if (stopWatcher) stopWatcher()

  const publicClient = getPublicClient()
  const account      = getAccount()

  stopWatcher = publicClient.watchContractEvent({
    address  : VAULT_ADDRESS,
    abi      : VAULT_ABI,
    eventName: 'Deposited',
    args     : { user: account },
    onLogs   : (logs) => {
      for (const l of logs) {
        _renderFeedItem('deposit', l.args, 'Just now')
        updateBalance(l.args.totalBalance)

        // Update stats display live
        const currentVolume = parseFloat(el.volumeDisplay.textContent.replace('$', '') || '0')
        const currentEvents = parseInt(el.eventsDisplay.textContent || '0', 10)
        el.volumeDisplay.textContent = '$' + (currentVolume + Number(l.args.amount) / 1e6).toFixed(2)
        el.eventsDisplay.textContent = currentEvents + 1

        showToast(`Saved ${formatUSDC(l.args.amount)} USDC from your spend ✓`)
      }
    },
  })
}

export function stopEventWatcher() {
  if (stopWatcher) { stopWatcher(); stopWatcher = null }
}

// ── Write: configure savings rate ─────────────────────────────────────────────
export async function configure(basisPoints) {
  const account      = getAccount()
  const publicClient = getPublicClient()
  const viem         = getViem()

  openModal('Activating savings', `Setting your rate to ${basisPoints / 100}%. Check MetaMask.`)

  try {
    const allowance = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: 'allowance', args: [account, VAULT_ADDRESS],
    })

    if (allowance < MAX_UINT256 / 2n) {
      updateModal('Approving USDC', 'First, approve the vault to spend your USDC.')
      const approveTx = await sendTx({
        to  : USDC_ADDRESS,
        data: viem.encodeFunctionData({ abi: USDC_ABI, functionName: 'approve', args: [VAULT_ADDRESS, MAX_UINT256] }),
      })
      await publicClient.waitForTransactionReceipt({ hash: approveTx })
      showToast('USDC approved ✓')
    }

    updateModal('Setting rate', `Configuring ${basisPoints / 100}% savings rate.`)

    const tx = await sendTx({
      to  : VAULT_ADDRESS,
      data: viem.encodeFunctionData({ abi: VAULT_ABI, functionName: 'configure', args: [BigInt(basisPoints)] }),
    })

    await publicClient.waitForTransactionReceipt({ hash: tx })

    const pct = basisPoints / 100
    el.rateDisplay.textContent  = pct + '%'
    el.configureBtn.textContent = 'Update Rate'
    el.pauseBtn.hidden          = false
    el.resumeBtn.hidden         = true

    setStatus('Active — catching all outbound USDC spends.', 'active')
    addFeedItem({ title: 'Rate Set', meta: `${pct}% · Just now`, type: 'config' })
    updateModal('Done!', `Savings active at ${pct}%.`, tx)
    showToast(`Savings activated at ${pct}% ✓`)

  } catch (err) {
    updateModal('Transaction failed', err.message || 'Something went wrong.')
  }
}

// ── Write: pause listening ────────────────────────────────────────────────────
export async function pauseListening() {
  const publicClient = getPublicClient()
  const viem         = getViem()

  openModal('Pausing savings', 'Confirm in MetaMask.')
  try {
    const tx = await sendTx({
      to  : VAULT_ADDRESS,
      data: viem.encodeFunctionData({ abi: VAULT_ABI, functionName: 'pauseListening', args: [] }),
    })
    await publicClient.waitForTransactionReceipt({ hash: tx })

    el.pauseBtn.hidden  = true
    el.resumeBtn.hidden = false
    setStatus('Savings paused — resume to start catching spends.', 'paused')
    addFeedItem({ title: 'Paused', meta: 'Just now', type: 'pause' })
    updateModal('Paused', 'Savings are paused. Your balance is safe.', tx)

  } catch (err) {
    updateModal('Failed', err.message || 'Something went wrong.')
  }
}

// ── Write: resume listening ───────────────────────────────────────────────────
export async function resumeListening() {
  const publicClient = getPublicClient()
  const viem         = getViem()

  openModal('Resuming savings', 'Confirm in MetaMask.')
  try {
    const tx = await sendTx({
      to  : VAULT_ADDRESS,
      data: viem.encodeFunctionData({ abi: VAULT_ABI, functionName: 'resumeListening', args: [] }),
    })
    await publicClient.waitForTransactionReceipt({ hash: tx })

    el.pauseBtn.hidden  = false
    el.resumeBtn.hidden = true
    setStatus('Active — catching all outbound USDC spends.', 'active')
    addFeedItem({ title: 'Resumed', meta: 'Just now', type: 'resume' })
    updateModal('Resumed', 'Savings are active again.', tx)

  } catch (err) {
    updateModal('Failed', err.message || 'Something went wrong.')
  }
}

// ── Write: withdraw full balance ──────────────────────────────────────────────
export async function withdraw() {
  const account      = getAccount()
  const publicClient = getPublicClient()
  const viem         = getViem()

  openModal('Withdrawing funds', 'Fetching your balance…')
  try {
    const balance = await publicClient.readContract({
      address: VAULT_ADDRESS, abi: VAULT_ABI,
      functionName: 'balanceOf', args: [account],
    })

    if (balance === 0n) {
      updateModal('Nothing to withdraw', 'Your vault balance is 0.')
      return
    }

    updateModal('Confirm withdrawal', `Withdrawing ${formatUSDC(balance)} USDC to your wallet.`)

    const tx = await sendTx({
      to  : VAULT_ADDRESS,
      data: viem.encodeFunctionData({ abi: VAULT_ABI, functionName: 'withdraw', args: [balance] }),
    })

    await publicClient.waitForTransactionReceipt({ hash: tx })

    updateBalance(0n)
    addFeedItem({ title: 'Withdrawal', meta: 'Just now', amount: `-${formatUSDC(balance)} USDC`, type: 'withdraw' })
    updateModal('Withdrawn ✓', `${formatUSDC(balance)} USDC sent to your wallet.`, tx)
    showToast(`Withdrew ${formatUSDC(balance)} USDC ✓`)

  } catch (err) {
    updateModal('Failed', err.message || 'Something went wrong.')
  }
}

// ── Internal: render feed item ────────────────────────────────────────────────
function _renderFeedItem(type, args, meta) {
  if (type === 'deposit') {
    addFeedItem({ title: 'Auto-Save', meta, amount: `+${formatUSDC(args.amount)} USDC`, type: 'save' })
  } else if (type === 'withdraw') {
    addFeedItem({ title: 'Withdrawal', meta, amount: `-${formatUSDC(args.amount)} USDC`, type: 'withdraw' })
  } else if (type === 'config') {
    addFeedItem({ title: 'Rate Set', meta: `${Number(args.basisPoints) / 100}% · ${meta}`, type: 'config' })
  } else if (type === 'pause') {
    addFeedItem({ title: 'Paused', meta, type: 'pause' })
  } else if (type === 'resume') {
    addFeedItem({ title: 'Resumed', meta, type: 'resume' })
  }
}