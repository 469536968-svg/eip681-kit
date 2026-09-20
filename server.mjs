// server.mjs — HTTP wrapper around eip681.mjs.
// Two jobs:
//   1. GET  /                      -> the offline validator UI (demo.html)
//   2. GET  /api/validate?uri=...  -> JSON validation result, free to call
//   3. POST /api/validate {uri}    -> same, for long URIs that break in a query string
//
// Design notes:
//  - Binds 0.0.0.0 and reads PORT from env so it can be run behind the sandbox proxy.
//  - No dependencies. No logging of caller IPs. No state. Nothing persisted.
//  - The paid-tier hook (/api/quote) is deliberately NOT enabled: payment rails are
//    not reachable from this host, and shipping a broken paywall would be worse than
//    shipping none.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, parseAmount, toChecksumAddress, erc20Transfer } from './eip681.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

function json(res, code, obj) {
  const body = JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(body);
}

function text(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*' });
  res.end(body);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function summarize(uri) {
  const v = parse(uri);
  return {
    uri,
    valid: v.ok,
    target: v.target,
    chainId: v.chainId,
    function: v.functionName,
    isTokenTransfer: v.isTokenTransfer,
    recipient: v.recipient ?? null,
    amount: v.amount === null ? null : v.amount.toString(),
    canonical: v.canonical,
    errors: v.errors,
    warnings: v.warnings,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') return json(res, 204, {});

  if (req.method === 'GET' && url.pathname === '/') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'demo.html'), 'utf8');
      return text(res, 200, html, 'text/html; charset=utf-8');
    } catch {
      return text(res, 200, 'eip681-kit validator API. GET /api/validate?uri=ethereum:0x...@1?value=1e18\n');
    }
  }

  if (url.pathname === '/api/validate') {
    try {
      let uri = null;
      if (req.method === 'GET') uri = url.searchParams.get('uri');
      else if (req.method === 'POST') {
        const raw = await readBody(req);
        try { uri = (JSON.parse(raw).uri) ?? null; } catch { uri = raw.trim() || null; }
      } else return json(res, 405, { error: 'method not allowed' });

      if (!uri) return json(res, 400, { error: 'missing "uri" (query param for GET, JSON body {"uri": "..."} for POST)' });
      return json(res, 200, summarize(uri));
    } catch (e) {
      return json(res, 400, { error: String(e.message || e) });
    }
  }

  // Amount arithmetic helper: exact bigint math, because floats are how money gets lost.
  if (req.method === 'GET' && url.pathname === '/api/amount') {
    const raw = url.searchParams.get('value');
    if (!raw) return json(res, 400, { error: 'missing "value"' });
    const a = parseAmount(raw);
    return json(res, 200, { input: raw, ok: a.ok, baseUnits: a.ok ? a.value.toString() : null, errors: a.errors });
  }

  if (req.method === 'GET' && url.pathname === '/api/checksum') {
    const addr = url.searchParams.get('address');
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr || '')) return json(res, 400, { error: 'address must be 20 hex bytes' });
    return json(res, 200, { address: addr, checksummed: toChecksumAddress(addr) });
  }

  if (req.method === 'GET' && url.pathname === '/api/build') {
    const q = url.searchParams;
    const r = erc20Transfer({ chainId: Number(q.get('chainId')), token: q.get('token'), to: q.get('to'), amount: q.get('amount') });
    if (!r.ok) return json(res, 400, { errors: r.errors });
    return json(res, 200, { uri: r.uri, validated: summarize(r.uri) });
  }

  if (url.pathname === '/healthz') return json(res, 200, { ok: true, service: 'eip681-kit', version: '1.0.0' });

  return json(res, 404, { error: 'not found', endpoints: ['/', '/api/validate', '/api/amount', '/api/checksum', '/api/build', '/healthz'] });
});

server.listen(PORT, HOST, () => console.log(`eip681-kit listening on ${HOST}:${PORT}`));
