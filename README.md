# Stash — Automated Savings on Arc

Stash watches your wallet and automatically routes a slice of every USDC spend into a non-custodial on-chain vault. Set a rate once, spend normally — Stash saves the rest for you.

- **Live app:** [savings-relayer.onrender.com](https://savings-relayer.onrender.com) ([health check](https://savings-relayer.onrender.com/health))
- **Vault contract (Arc mainnet):** [`0xad114a8B963F1AD5583a24d4013ce4bBbdA34275`](https://explorer.arc.io/address/0xad114a8B963F1AD5583a24d4013ce4bBbdA34275)
- **Vault contract (Arc testnet, prior dev deployment):** [`0x85167aCDf3D91D00aE0df19aD02eDbb44e2278F0`](https://testnet.arcscan.app/address/0x85167aCDf3D91D00aE0df19aD02eDbb44e2278F0)
- **Builder:** [Emmanuel-webDev](https://github.com/Emmanuel-webDev)
- **Repo:** [github.com/Emmanuel-webDev/Stash](https://github.com/Emmanuel-webDev/Stash)

---

## What it does

1. You connect a wallet and pick a savings rate (1–20%).
2. Every time USDC leaves your wallet on Arc — a swap, a transfer, a payment, anything — Stash catches it.
3. It computes `spend × rate` and deposits that amount straight into your personal balance in the `SavingsVault` contract.
4. Withdraw anytime. You always control the funds; the relayer can only *add* to your balance, never move it out.

## What it uses Arc for

Arc is USDC-native: USDC *is* the gas token, so a relayer can pay for transactions in the exact same asset it's saving on your behalf — no separate gas token to bridge or hold.

- **Settlement:** `SavingsVault.sol` is deployed on Arc; every deposit/withdraw is a real Arc transaction.
- **Detection:** the relayer polls Arc's system emitter (`0xfff...ffe`) for `Transfer` events to catch outbound USDC spends in real time, no indexer required.
- **Execution:** on a qualifying spend, the relayer submits `depositFor(user, amount)` directly from its own EOA, paying gas in Arc-native USDC.

## Architecture

```
User spends USDC on Arc
  → Arc's system emitter fires a Transfer event
    → Relayer polls for the log (getLogs over block ranges, ~1s interval)
      → DB lookup: is this sender an active registered user?
        → Compute savings = spendAmount × basisPoints / 10000
          → Relayer calls depositFor(user, savings) from its own EOA
            → Relayer pays gas in USDC (Arc's native gas token)
              → Vault credits the user's balance
```

## Tech stack

- **Relayer** — Node 20 + TypeScript, [viem](https://viem.sh), `better-sqlite3`. Pure background listener, no framework.
- **Frontend** — vanilla HTML/CSS/JS (ES modules), viem loaded from CDN, talks to the chain directly via MetaMask. No build step, no bundler.
- **Storage** — SQLite (`relayer.db`): `registered_users` (synced from on-chain `Configured`/`Paused`/`Resumed` events) and `processed_logs` (idempotency).

## Project structure

```
src/
  index.ts              entrypoint — starts the HTTP server + both listeners
  server.ts             health check + serves ui/ (so this runs as a Render Web Service)
  config.ts             env-driven config, Arc chain definition
  abis.ts                ABI fragments the relayer needs
  db/
    schema.ts            shared table definitions (applied on every boot)
    migrate.ts            standalone `npm run db:migrate` entrypoint
    store.ts              prepared-statement DB access
  listeners/
    transferEvents.ts      watches the system emitter for outbound USDC spends
    vaultEvents.ts          watches + backfills Configured/Paused/Resumed
  processor/
    deposit.ts             computes savings, submits depositFor
  utils/
    clients.ts              viem public/wallet clients
    watchLogs.ts             stateless getLogs polling (Arc's public RPC drops filters)
    logger.ts                console logging
ui/                       static dashboard (index.html, wallet.js, vault.js, ...)
```

## Running locally

```bash
npm install
cp .env.example .env      # fill in RELAYER_PRIVATE_KEY, VAULT_ADDRESS, etc.
npm run dev                # tsx watch — auto-restarts on file change
```

The DB schema is applied automatically on boot (`src/db/schema.ts`), so `npm run db:migrate` is optional — kept for explicit/manual runs.

Once running, open `http://localhost:3000` for the dashboard and `http://localhost:3000/health` for a JSON status check (relayer address, vault, active user count).

Full step-by-step setup (deploying the vault, funding the relayer, testing the flow end-to-end) is in [`GUIDE.md`](./GUIDE.md).

## Deploying to Render (free tier)

Render's free tier only runs **Web Services** — a process that binds `$PORT` and answers HTTP — not standalone background workers. `src/server.ts` makes the relayer double as one: the dashboard and `/health` are served from the same process that runs the event listeners, so one free service is all you need.

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, point it at the repo — it will pick up [`render.yaml`](./render.yaml) and create the service automatically. (Or **New → Web Service** manually with build command `npm install && npm run build` and start command `npm start`.)
3. Set the environment variables Render prompts for (from `.env.example`): `RELAYER_PRIVATE_KEY`, `VAULT_ADDRESS`, `USDC_ADDRESS`, `ARC_RPC_HTTP`, `VAULT_DEPLOY_BLOCK`.
4. Deploy. Render sets `PORT` automatically; the app binds to it. Health checks hit `/health`.

**Free-tier caveat:** the disk is ephemeral — `relayer.db` resets on every redeploy (and possibly on spin-down/spin-up). That's fine here: `registered_users` is rebuilt automatically from the full on-chain event history on every boot, and outbound-spend watching is live-forward only, so a reset doesn't cause missed or duplicate deposits. If you outgrow this, move to Render's paid tier with a persistent disk, or swap `better-sqlite3` for a hosted Postgres.

## Moving from Arc testnet → Arc mainnet

The codebase is now pointed at Arc **mainnet** (chain ID `5042`). Values below were verified directly — against [Circle's official Arc docs](https://docs.arc.io/arc/references/rpc-endpoints) and by querying `eth_chainId`/`eth_blockNumber` on the live RPCs — not assumed:

| | Value | Source |
|---|---|---|
| Chain ID | `5042` | docs.arc.io + confirmed live via `eth_chainId` |
| RPC (primary) | `https://rpc.mainnet.arc.io` | Circle's official endpoint |
| RPC (fallback) | `https://rpc.arc-scan.org` | Third-party, also confirmed live at chain 5042 |
| Explorer | `https://explorer.arc.io` | Circle's official Blockscout instance |
| USDC address | `0x3600000000000000000000000000000000000000` | Same on testnet and mainnet, per docs.arc.io |
| Native decimals | `18` | Arc's native gas interface uses 18 decimals; the USDC ERC-20 interface used for balances/transfers uses 6 — same asset, two views, 1e12 apart (already handled in `transferEvents.ts`) |

Already done in code: `src/config.ts`, `ui/config.js`, `ui/chain.js`, `ui/wallet.js`, and the `Arc Testnet` labels in `ui/index.html` all reflect the mainnet values above. `src/index.ts` now also verifies on every boot that `ARC_RPC_HTTP` actually serves the chain ID the app is built for, and refuses to start otherwise — viem does **not** check this on its own (confirmed by testing: pointing mainnet config at a testnet RPC ran with no error before this check was added).

- [x] Redeploy `SavingsVault.sol` on Arc mainnet — live at `0xad114a8B963F1AD5583a24d4013ce4bBbdA34275`, deployed at block `21343272`.
- [x] Fresh relayer wallet generated and funded, `setRelayer` updated on the vault.
- [x] `.env` and `ui/config.js` updated with the real vault address/deploy block — confirmed live (real contract bytecode at that address, relayer backfilled successfully from block `21343272`).
- [ ] Push this repo to GitHub and update the "Live app" / repo links above once Render is deployed.

Arc mainnet only launched this week, so its RPC/explorer ecosystem is still young — worth re-verifying these against docs.arc.io yourself before you deploy, in case anything's changed since.

## Security notes

- The relayer's private key is a plain EOA key with **no special vault permissions beyond `depositFor`** — it cannot withdraw or move user funds out of the vault. Users remain fully non-custodial: only they can call `withdraw`.
- `.env` is git-ignored; never commit it. `.env.example` documents the required shape with no real values.
- `relayer.db*` is git-ignored — it's a rebuildable cache, not a source of truth (the chain is).

## Arc Microgrants submission checklist

- [x] Live deployment on Arc **mainnet** — [savings-relayer.onrender.com](https://savings-relayer.onrender.com), confirmed live and healthy
- [x] Public repo link — [github.com/Emmanuel-webDev/Stash](https://github.com/Emmanuel-webDev/Stash)
- [x] Project description + what it uses Arc for — this README
- [x] Public builder profile — [github.com/Emmanuel-webDev](https://github.com/Emmanuel-webDev)
