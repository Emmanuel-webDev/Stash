# SavingsVault Relayer — Setup & Connection Guide

> For a project overview, the Render deployment steps, and the Arc mainnet migration checklist, see [`README.md`](./README.md). This guide covers local dev setup only.

## Architecture overview

```
User spends USDC on Arc
  → Arc node emits Transfer event
    → Relayer polls for the log (block-range getLogs, ~1s interval)
      → DB lookup: is this sender an active registered user? (< 0.1ms SQLite)
        → Compute savings = spendAmount × basisPoints / 10000
          → Relayer sends depositFor(user, spendAmount) — vault computes savings on-chain
            → Relayer pays gas in USDC (Arc's native gas token)
              → Vault credits the user's balance
```

---

## Prerequisites

- Node.js 20+
- A wallet private key (for the relayer — a plain EOA, no account abstraction)
- SavingsVault.sol deployed on Arc

---

## Step 1 — Deploy the vault

In Remix, set environment to **Injected Provider (MetaMask)** and switch MetaMask to Arc:

| Field | Mainnet | Testnet (dry run) |
|---|---|---|
| Network name | Arc | Arc Testnet |
| RPC URL | https://rpc.mainnet.arc.io | https://rpc.testnet.arc.network |
| Chain ID | 5042 | 5042002 |
| Currency | USDC (18 decimals) | USDC |
| Explorer | https://explorer.arc.io | https://testnet.arcscan.app |

This codebase defaults to **mainnet**. If you want to dry-run the full flow on testnet first (recommended before moving real funds), see [`README.md`](./README.md)'s testnet↔mainnet table and swap the values back.

Deploy `SavingsVault.sol` with:
- `_usdc` = `0x3600000000000000000000000000000000000000` (Arc system USDC)
- `_relayer` = your relayer wallet address (see Step 3 to get this)

> **Deploy order:** Run Step 3 first to get the relayer address, then deploy the vault with that address as `_relayer`.

---

## Step 2 — Install and configure the relayer

```bash
# Clone / copy relayer folder
cd relayer
npm install

# Create your .env
cp .env.example .env
```

Edit `.env`:

```env
RELAYER_PRIVATE_KEY=0x_your_private_key
VAULT_ADDRESS=0x_your_deployed_vault_address
USDC_ADDRESS=0x3600000000000000000000000000000000000000
ARC_RPC_HTTP=https://rpc.mainnet.arc.io
```

(No `ARC_RPC_WSS` — this app only polls over HTTP; see `src/utils/watchLogs.ts` for why.)

---

## Step 3 — Get your relayer address

The relayer is a plain EOA wallet derived from `RELAYER_PRIVATE_KEY` — no smart account, no bundler.

Run the relayer once to see it:

```bash
npm run db:migrate
npm run dev
```

You'll see:
```
Relayer: 0xYourRelayerAddress
```

**Copy this address** — you need it for two things:
1. Pass it as `_relayer` when deploying the vault
2. Fund it with USDC for gas

---

## Step 4 — Fund the relayer with USDC

**Mainnet:** transfer a small amount of real USDC to the relayer address on Arc (bridge in via CCTP, or send from an exchange that supports Arc withdrawals). Gas is cheap — a few dollars covers a very large number of deposits — but this is real money, so start small and confirm the flow works before topping up further.

**Testnet (dry run):** go to https://faucet.circle.com → select **Arc Testnet** → paste your relayer address. You get 1 USDC/day, and testnet gas costs ~0.000001 USDC per tx — 1 USDC covers thousands of deposits.

---

## Step 5 — Run DB migration

```bash
npm run db:migrate
```

Creates `relayer.db` with two tables:
- `registered_users` — wallets the relayer watches
- `processed_logs` — idempotency log (prevents double-deposits)

---

## Step 6 — Connect vault to relayer (update `_relayer` in vault)

If you deployed the vault before getting the relayer address:
1. Call `setRelayer(relayerAddress)` on the vault from the owner account
2. Verify: call `relayer()` on the vault — should return the relayer address

---

## Step 7 — Start the relayer

```bash
# Development (auto-restarts on file change)
npm run dev

# Production
npm run build && npm start
```

---

## Step 8 — Test the full flow

### On Remix:

1. **User configures vault:**
   ```
   configure(500)  // 5% savings rate
   ```
   → Relayer receives `Configured` event → stores user in DB

2. **User approves vault to spend USDC:**
   ```
   USDC.approve(vaultAddress, 50_000000)  // 50 USDC — the app's bounded approval, not unlimited
   ```
   The production UI approves a bounded amount (50 USDC, see `ui/config.js`'s
   `APPROVAL_TOPUP_USDC`) rather than `MAX_UINT256`, and re-prompts for a top-up
   once it runs low — this caps how much a compromised relayer or vault bug
   could ever pull in one shot. On testnet you can use a `MockUSDC` contract for
   this. On mainnet there's no mock — call `approve`/`transfer` directly on the
   real USDC contract at `0x3600...0000`, with a small real amount, since this
   is live money.

3. **Simulate a spend (transfer USDC anywhere):**
   ```
   USDC.transfer(anyAddress, 100_000000)  // spend 100 USDC
   ```
   → Relayer receives `Transfer` event
   → DB lookup: user is active @ 500bp
   → Relayer calls `depositFor(user, 100_000000)` — passes the raw spend amount, not a pre-computed savings figure
   → **Vault itself** computes savings on-chain: 100 × 500 / 10000 = 5 USDC, and credits it

4. **Verify:**
   ```
   vault.balanceOf(userAddress)  // should return 5_000000
   ```

5. **Test pauseListening:**
   ```
   vault.pauseListening()
   ```
   → Relayer receives `ListeningPaused` → sets is_listening = 0
   → Next Transfer from that user is ignored

---

## Running in production (PM2)

```bash
npm install -g pm2
npm run build
pm2 start dist/index.js --name savings-relayer
pm2 logs savings-relayer
pm2 save  # persist across reboots
```

---

## Monitoring

Watch gas balance — if the relayer runs out of USDC, transactions fail:

```bash
# Check relayer USDC balance via Arc explorer
https://explorer.arc.io/address/YOUR_RELAYER_ADDRESS
```

Set up a balance alert: add a cron job that checks the balance and emails/Slacks when it drops below a threshold.

---

## DB tables explained

**`registered_users`**
| Column | Purpose |
|---|---|
| `address` | User wallet (lowercase) — PRIMARY KEY |
| `basis_points` | Savings rate e.g. 500 = 5% |
| `is_listening` | 1 = active, 0 = paused by user |

Populated automatically from vault events — no manual entry needed.

**`processed_logs`**
| Column | Purpose |
|---|---|
| `log_id` | `{txHash}-{logIndex}` — PRIMARY KEY |
| `user_address` | Which user this deposit was for |
| `spend_amount` | The USDC transfer that triggered it |
| `savings_amount` | How much was deposited to vault |

Prevents double-deposits if the WS reconnects and replays logs.

---

## Upgrading to a private RPC

The public endpoint (`rpc.mainnet.arc.io`) rate-limits aggressively — this app is already built around that (see `src/utils/watchLogs.ts`), but a private endpoint gets you higher limits and an uptime SLA. Per [docs.arc.io](https://docs.arc.io/arc/references/rpc-endpoints), mainnet options include:
- **Alchemy** — `https://arc-mainnet.g.alchemy.com/v2/YOUR_API_KEY`
- **Blockdaemon** — `https://rpc.blockdaemon.mainnet.arc.io`
- **dRPC** — `https://rpc.drpc.mainnet.arc.io`
- **QuickNode** — `https://rpc.quicknode.mainnet.arc.io`

Just swap `ARC_RPC_HTTP` in `.env` — no code changes needed.
