/**
 * Run once before starting: npm run db:migrate
 *
 * registered_users — wallets the relayer watches (synced from vault events)
 * processed_logs   — idempotency table (prevents double-deposits on WS replay)
 */

import Database from 'better-sqlite3'
import { resolve } from 'path'
import { applySchema } from './schema.js'

const db = new Database(resolve(process.cwd(), 'relayer.db'))

// WAL mode: concurrent reads don't block writes — critical for a hot-path relayer
db.pragma('journal_mode = WAL')
db.pragma('synchronous  = NORMAL') // safe with WAL; faster than FULL

applySchema(db)

console.log('✅ DB migrated → relayer.db')
db.close()
