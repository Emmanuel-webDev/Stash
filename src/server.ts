/**
 * Minimal HTTP layer — no framework, no new dependencies.
 *
 * Render's free tier only runs "Web Services" (a process that binds $PORT
 * and answers HTTP), not background workers. This lets the relayer double
 * as a web service: it serves the static dashboard (ui/) and a /health
 * endpoint, while the event listeners keep running in the same process.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
import { store } from './db/store.js'
import { relayerAccount } from './utils/clients.js'
import { config } from './config.js'
import { log } from './utils/logger.js'

const UI_DIR = join(process.cwd(), 'ui')

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js'  : 'text/javascript; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg' : 'image/svg+xml',
  '.png' : 'image/png',
  '.ico' : 'image/x-icon',
}

function healthPayload() {
  return {
    status     : 'ok',
    relayer    : relayerAccount.address,
    vault      : config.vaultAddress,
    usdc       : config.usdcAddress,
    activeUsers: store.getAllActive().length,
    uptimeSec  : Math.floor(process.uptime()),
  }
}

export function startServer(): void {
  const port = Number(process.env.PORT ?? 3000)

  const server = createServer(async (req, res) => {
    const url = req.url ?? '/'

    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(healthPayload()))
      return
    }

    const requestPath = normalize(url === '/' ? '/index.html' : url).replace(/^(\.\.[/\\])+/, '')
    const filePath = join(UI_DIR, requestPath)

    if (!filePath.startsWith(UI_DIR)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    try {
      const data = await readFile(filePath)
      res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream' })
      res.end(data)
    } catch {
      res.writeHead(404)
      res.end('Not found')
    }
  })

  server.listen(port, () => log.ok(`HTTP server + dashboard live on :${port}`))
}
