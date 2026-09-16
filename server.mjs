import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const dist = join(root, 'dist')
const port = Number(process.env.PORT || 4321)
const rpcUrl = process.env.BOTCHAIN_RPC_URL || 'https://rpc.bohr.life'
const marketUrl = process.env.BITGET_API_BASE || 'https://api.bitget.com'
const allowedRpc = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getCode', 'eth_call'])
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' }
let requestId = 0
const requestWindow = new Map()

function overLimit(req) {
  const now = Date.now()
  const ip = req.socket.remoteAddress || 'unknown'
  const prior = requestWindow.get(ip)
  if (!prior || now - prior.startedAt >= 60_000) { requestWindow.set(ip, { startedAt: now, count: 1 }); return false }
  prior.count += 1
  return prior.count > 300
}

function headers(res) {
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('x-frame-options', 'DENY')
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin')
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()')
  if (res.req?.headers['x-forwarded-proto'] === 'https') res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains')
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'")
}

async function readBody(req, limit = 32000) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('Request body too large.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function proxyRpc(req, res) {
  if (req.method !== 'POST') { res.writeHead(405).end(); return }
  try {
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('Use application/json content type.')
    const body = JSON.parse(await readBody(req))
    if (!allowedRpc.has(body.method) || !Array.isArray(body.params)) throw new Error('RPC method is not allowed.')
    if (body.method === 'eth_chainId' || body.method === 'eth_blockNumber') { if (body.params.length !== 0) throw new Error('Unexpected RPC parameters.') }
    if (body.method === 'eth_getCode') {
      const [address, block] = body.params
      if (body.params.length !== 2 || typeof address !== 'string' || !/^0x[\da-fA-F]{40}$/.test(address) || address.toLowerCase() !== (process.env.VITE_DRIFT_CONTRACT_ADDRESS || '').toLowerCase() || !['latest', 'safe', 'finalized', 'pending'].includes(String(block)) && !/^0x[\da-fA-F]+$/.test(String(block))) throw new Error('Only the configured receipt contract code may be queried.')
    }
    if (body.method === 'eth_call') {
      const [call, block] = body.params
      const to = (call && typeof call === 'object' && 'to' in call) ? call.to : ''
      const data = (call && typeof call === 'object' && 'data' in call) ? call.data : ''
      if (body.params.length !== 2 || String(to).toLowerCase() !== (process.env.VITE_DRIFT_CONTRACT_ADDRESS || '').toLowerCase() || typeof data !== 'string' || !/^0x(?:[\da-fA-F]{8}|[\da-fA-F]{8}[\da-fA-F]*)$/.test(data) || block !== 'latest') throw new Error('Only latest-state reads against the configured receipt contract are allowed.')
    }
    const upstream = await fetch(rpcUrl, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method: body.method, params: body.params }), signal: AbortSignal.timeout(9000) })
    const data = await upstream.json()
    res.writeHead(upstream.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(data))
  } catch (error) {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: error instanceof Error ? error.message : 'RPC unavailable.' }))
  }
}

async function market(req, res, url) {
  if (req.method !== 'GET') { res.writeHead(405).end(); return }
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase()
  if (!/^[A-Z0-9]{2,12}USDT$/.test(symbol)) { res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"Use a valid USDT market symbol."}'); return }
  try {
    const upstream = await fetch(`${marketUrl}/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol=${encodeURIComponent(symbol)}`, { redirect: 'error', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(9000) })
    if (!upstream.ok) throw new Error(`Market provider responded ${upstream.status}.`)
    const data = await upstream.json()
    if (data.code !== '00000' || !Array.isArray(data.data)) throw new Error(data.msg || 'Market data unavailable.')
    const ticker = data.data.find((item) => item.symbol === symbol)
    const price = Number(ticker?.lastPr)
    if (!ticker || !Number.isFinite(price) || price <= 0) throw new Error('No valid ticker was returned for this symbol.')
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify({ symbol, price, source: 'Bitget public market ticker', observedAt: new Date(Number(ticker.ts)).toISOString() }))
  } catch (error) {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: error instanceof Error ? error.message : 'Market source unavailable.' }))
  }
}

createServer(async (req, res) => {
  res.req = req
  headers(res)
  const url = new URL(req.url || '/', 'http://localhost')
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify({ ok: true, service: 'drift', revision: process.env.RAILWAY_GIT_COMMIT_SHA || 'local', chainId: 968 }))
    return
  }
  if ((url.pathname === '/api/rpc' || url.pathname === '/api/market') && overLimit(req)) { res.writeHead(429, { 'retry-after': '60' }).end(); return }
  if (url.pathname === '/api/rpc') return proxyRpc(req, res)
  if (url.pathname === '/api/market') return market(req, res, url)
  if (url.pathname.startsWith('/api/')) { res.writeHead(404).end(); return }
  if (!existsSync(dist)) { res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }).end('Build the app with npm run build before starting the production server.'); return }
  let pathname
  try { pathname = decodeURIComponent(url.pathname) } catch { res.writeHead(400).end(); return }
  let target = resolve(dist, `.${pathname}`)
  if (target !== dist && !target.startsWith(`${dist}${sep}`)) { res.writeHead(404).end(); return }
  if (!existsSync(target) || statSync(target).isDirectory()) target = join(dist, 'index.html')
  res.writeHead(200, { 'content-type': mime[extname(target)] || 'application/octet-stream' })
  createReadStream(target).pipe(res)
}).listen(port, '0.0.0.0', () => console.log(`Drift listening on 0.0.0.0:${port}`))
