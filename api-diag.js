// api-diag.js — diagnostic route, mounted in server.js as POST /api/diag
// Tests DNS resolution and TCP connectivity to CM SMTP, independently of nodemailer.

import dns from 'dns/promises';
import net from 'net';

const CM_HOST = 'smtp.transactional.createsend.com';
const PORTS   = [2525, 465, 587, 25];

function tcpProbe(host, port, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const start  = Date.now();
    const socket = new net.Socket();
    const done   = (result) => {
      socket.destroy();
      resolve({ port, ms: Date.now() - start, ...result });
    };
    socket.setTimeout(timeoutMs);
    socket.connect(port, host, () => done({ ok: true }));
    socket.on('error',   (err) => done({ ok: false, error: err.message, code: err.code }));
    socket.on('timeout', ()    => done({ ok: false, error: 'TCP timeout', code: 'ETIMEDOUT' }));
  });
}

export async function diagHandler(req, res) {
  const report = { host: CM_HOST, dns: null, ports: [] };

  // 1. DNS
  try {
    const addrs = await dns.resolve4(CM_HOST);
    report.dns = { ok: true, addresses: addrs };
  } catch (err) {
    report.dns = { ok: false, error: err.message, code: err.code };
  }

  // 2. TCP probes (run in parallel for speed)
  report.ports = await Promise.all(PORTS.map(p => tcpProbe(CM_HOST, p)));

  const anyOpen = report.ports.some(p => p.ok);
  res.status(anyOpen ? 200 : 502).json(report);
}
