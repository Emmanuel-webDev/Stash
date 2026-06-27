# SavingsVault Relayer — Setup & Connection Guide

## Architecture overview

```
User spends USDC on Arc testnet
  → Arc node emits Transfer event
    → Relayer WS subscription receives log instantly (sub-second, Malachite finality)
      → DB lookup: is this sender an active registered user? (< 0.1ms SQLite)
        → Compute savings = spendAmount × basisPoints / 10000
          → Send UserOperation to Pimlico bundler
            → Pimlico paymaster pays gas in USDC (free on testnet)
              → Vault calls transferFrom(user → vault) and credits balance
```

---

## Prerequisites

- Node.js 20+
- A wallet private key (for the relayer smart account owner)
- Pimlico API key (free at https://dashboard.pimlico.io)
- SavingsVault.sol deployed on Arc testnet

---

## Step 1 — Deploy the vault on Arc testnet

In Remix, set environment to **Injected Provider (MetaMask)** and switch MetaMask to Arc Testnet:

| Field | Value |
|---|---|
| Network name | Arc Testnet |
| RPC URL | https://rpc.testnet.arc.network |
| Chain ID | 5042002 |
| Currency | USDC |
| Explorer | https://testnet.arcscan.app |

Deploy `SavingsVault.sol` with:
- `_usdc` = `0x3600000000000000000000000000000000000000` (Arc system USDC)
- `_relayer` = your relayer smart account address (see Step 3 to get this)

> **Deploy order:** Run Step 3 first to get the smart account address, then deploy the vault with that address as `_relayer`.

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
PIMLICO_API_KEY=your_pimlico_api_key
VAULT_ADDRESS=0x_your_deployed_vault_address
USDC_ADDRESS=0x3600000000000000000000000000000000000000
ARC_RPC_HTTP=https://rpc.testnet.arc.network
ARC_RPC_WSS=wss://rpc.testnet.arc.network
```

---

## Step 3 — Get your smart account address

The relayer uses an ERC-4337 smart account (not a plain EOA). The smart account address is deterministic from your private key.

Run the relayer once to see it:

```bash
npm run db:migrate
npm run dev
```

You'll see:
```
✅  Smart account (relayer): 0xYourSmartAccountAddress
⚠️  Fund this address with testnet USDC for gas → https://faucet.circle.com
```

**Copy this address** — you need it for two things:
1. Pass it as `_relayer` when deploying the vault
2. Fund it with testnet USDC for gas

---

## Step 4 — Fund the smart account with testnet USDC

Go to https://faucet.circle.com → select **Arc Testnet** → paste your smart account address.

You get 1 USDC/day. On Arc testnet, gas costs ~0.000001 USDC per tx — 1 USDC covers thousands of deposits.

> **Important:** Fund the SMART ACCOUNT address (from Step 3), not your private key's EOA address.

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

If you deployed the vault before getting the smart account address:
1. Call `setRelayer(smartAccountAddress)` on the vault from the owner account
2. Verify: call `relayer()` on the vault — should return the smart account address

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

### On Remix (Arc testnet):

1. **User configures vault:**
   ```
   configure(500)  // 5% savings rate
   ```
   → Relayer receives `Configured` event → stores user in DB

2. **User approves vault to spend USDC:**
   ```
   MockUSDC.approve(vaultAddress, 1000_000000)  // 1000 USDC
   ```

3. **Simulate a spend (transfer USDC anywhere):**
   ```
   MockUSDC.transfer(anyAddress, 100_000000)  // spend 100 USDC
   ```
   → Relayer receives `Transfer` event
   → DB lookup: user is active @ 500bp
   → Computes savings: 100 × 500 / 10000 = 5 USDC
   → Sends UserOp to Pimlico → vault credits 5 USDC to user

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

Watch gas balance — if the smart account runs out of USDC, UserOps fail:

```bash
# Check smart account USDC balance via Arc explorer
https://testnet.arcscan.app/address/YOUR_SMART_ACCOUNT_ADDRESS
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

## Upgrading to production RPC

Replace the public endpoints in `.env` with a private endpoint from:
- **QuickNode** — https://www.quicknode.com/docs/arc (HTTP + WSS, Arc testnet confirmed)
- **dRPC** — https://drpc.org/chainlist/arc-testnet-rpc
- **Blockdaemon** — listed in Arc's official node provider docs

Private endpoints have higher rate limits and guaranteed uptime SLAs.
