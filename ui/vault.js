// ═══════════════════════════════════════════════
// vault.js — Vault contract interactions
// ═══════════════════════════════════════════════

import { VAULT_ADDRESS, USDC_ADDRESS, VAULT_ABI, USDC_ABI, MAX_UINT256, VAULT_DEPLOY_BLOCK } from './config.js'
import { getAccount, getPublicClient, getViem, sendTx } from './wallet.js'
import { addFeedItem, setStatus, updateBalance, formatUSDC, el, showToast, openModal, updateModal, friendlyError } from './ui.js'

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
//
// Fetches ONE unfiltered getLogs call per chunk (instead of 5, one per event
// type) and decodes/routes locally by topic0 — Arc's public RPC rate-limits
// aggressively (429 "request limit reached"), and 5x the requests was slow
// and error-prone on every wallet connect.
async function loadRecentEvents() {
  const account      = getAccount()
  const publicClient = getPublicClient()
  const viem         = getViem()

  const EVENTS = ['Deposited', 'Withdrawn', 'Configured', 'ListeningPaused', 'ListeningResumed']
    .map(name => VAULT_ABI.find(e => e.name === name))

  const topicToEvent = new Map(
    EVENTS.map(ev => [viem.encodeEventTopics({ abi: [ev], eventName: ev.name })[0], ev])
  )

  const allDeposits    = []
  const allWithdrawals = []
  const allConfigs     = []
  const allPauses      = []
  const allResumes     = []

  try {
    const currentBlock = await publicClient.getBlockNumber()
    const accountLower  = account.toLowerCase()

    // Chunk through all blocks from vault deploy to now
    for (let from = VAULT_DEPLOY_BLOCK; from <= currentBlock; from += CHUNK_SIZE) {
      const to = from + CHUNK_SIZE - 1n > currentBlock ? currentBlock : from + CHUNK_SIZE - 1n

      const logs = await publicClient.getLogs({ address: VAULT_ADDRESS, fromBlock: from, toBlock: to })

      for (const l of logs) {
        const matched = l.topics[0] ? topicToEvent.get(l.topics[0]) : undefined
        if (!matched) continue

        let decoded
        try {
          decoded = viem.decodeEventLog({ abi: [matched], data: l.data, topics: l.topics })
        } catch {
          continue
        }
        if (!decoded.args?.user || decoded.args.user.toLowerCase() !== accountLower) continue

        const entry = { ...l, args: decoded.args }
        if (decoded.eventName === 'Deposited')             allDeposits.push(entry)
        else if (decoded.eventName === 'Withdrawn')        allWithdrawals.push(entry)
        else if (decoded.eventName === 'Configured')       allConfigs.push(entry)
        else if (decoded.eventName === 'ListeningPaused')  allPauses.push(entry)
        else if (decoded.eventName === 'ListeningResumed') allResumes.push(entry)
      }

      // Small gap between chunks — avoids bursting Arc's public RPC rate limit
      if (to < currentBlock) await new Promise(r => setTimeout(r, 150))
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
    updateModal('Transaction failed', friendlyError(err), '', 'error')
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
    updateModal('Failed', friendlyError(err), '', 'error')
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
    updateModal('Failed', friendlyError(err), '', 'error')
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
    updateModal('Failed', friendlyError(err), '', 'error')
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