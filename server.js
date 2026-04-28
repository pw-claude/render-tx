import express        from 'express';
import dns            from 'dns/promises';
import nodemailer     from 'nodemailer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { diagHandler } from './api-diag.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(join(__dirname, 'public')));

// ── POST /api/proxy ───────────────────────────────────────────────────────────
app.post('/api/proxy', async (req, res) => {
  const { method, path, apiKey, body } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });
  if (!path)   return res.status(400).json({ error: 'path is required' });

  const url        = 'https://api.createsend.com' + path;
  const authHeader = 'Basic ' + Buffer.from(apiKey + ':x').toString('base64');
  const fetchOpts  = {
    method:  method || 'GET',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
  };
  if (body && method !== 'GET') fetchOpts.body = JSON.stringify(body);

  try {
    const upstream = await fetch(url, fetchOpts);
    const text = await upstream.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: 'Upstream request failed', detail: err.message });
  }
});

// ── POST /api/smtp ────────────────────────────────────────────────────────────
// CM SMTP: username = SMTP Token, password = SMTP Token
const CM_SMTP_HOST = 'smtp.api.createsend.com';
const SMTP_PORTS = [
  { port: 2525, secure: false, requireTLS: true  },
  { port: 465,  secure: true,  requireTLS: false },
  { port: 587,  secure: false, requireTLS: true  },
];

async function trySend(smtpToken, mailOptions, portConfig) {
  const transporter = nodemailer.createTransport({
    host:              CM_SMTP_HOST,
    port:              portConfig.port,
    secure:            portConfig.secure,
    requireTLS:        portConfig.requireTLS,
    auth:              { user: smtpToken, pass: smtpToken },
    connectionTimeout: 10000,
    greetingTimeout:   10000,
    socketTimeout:     15000,
  });
  return transporter.sendMail(mailOptions);
}

app.post('/api/smtp', async (req, res) => {
  const { smtpToken, from, to, cc, bcc, replyTo, subject, html, text, port } = req.body || {};

  if (!smtpToken)     return res.status(400).json({ error: 'smtpToken is required' });
  if (!from)          return res.status(400).json({ error: 'from is required' });
  if (!to)            return res.status(400).json({ error: 'to is required' });
  if (!subject)       return res.status(400).json({ error: 'subject is required' });
  if (!html && !text) return res.status(400).json({ error: 'html or text body is required' });

  const normalise   = v => Array.isArray(v) ? v.join(', ') : v;
  const mailOptions = { from, to: normalise(to), subject };
  if (cc)      mailOptions.cc      = normalise(cc);
  if (bcc)     mailOptions.bcc     = normalise(bcc);
  if (replyTo) mailOptions.replyTo = replyTo;
  if (html)    mailOptions.html    = html;
  if (text)    mailOptions.text    = text;

  // Honour explicit port selection, or try all in order if 'auto'
  const specificPort  = port && port !== 'auto' ? parseInt(port, 10) : null;
  const portsToTry    = specificPort
    ? [SMTP_PORTS.find(p => p.port === specificPort) || { port: specificPort, secure: specificPort === 465, requireTLS: specificPort !== 465 }]
    : SMTP_PORTS;

  const attempts = [];
  for (const portConfig of portsToTry) {
    try {
      const info = await trySend(smtpToken, mailOptions, portConfig);
      return res.status(200).json({
        success: true, port_used: portConfig.port,
        messageId: info.messageId, accepted: info.accepted,
        rejected:  info.rejected,  response:  info.response,
      });
    } catch (err) {
      attempts.push({ port: portConfig.port, error: err.message, code: err.code || null });
      if (err.responseCode === 535 || err.code === 'EAUTH') {
        return res.status(401).json({ error: 'SMTP authentication failed — check your SMTP Token', attempts });
      }
    }
  }

  const triedPorts = portsToTry.map(p => p.port).join(', ');
  return res.status(502).json({
    error:   `SMTP send failed on port${portsToTry.length > 1 ? 's' : ''} ${triedPorts}`,
    detail:  'All connection attempts timed out.',
    attempts,
  });
});

// ── GET /api/diag ─────────────────────────────────────────────────────────────
app.get('/api/diag', diagHandler);

// ── Catch-all SPA ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`CM Tester running on http://localhost:${PORT}`));

// ── GET /api/dns ──────────────────────────────────────────────────────────────
// Query: ?domain=example.com&type=TXT|CNAME|MX|A

app.get('/api/dns', async (req, res) => {
  const { domain, type = 'TXT' } = req.query;
  if (!domain) return res.status(400).json({ error: 'domain is required' });
  const validTypes = ['A','AAAA','CNAME','MX','TXT','NS','SOA'];
  const t = type.toUpperCase();
  if (!validTypes.includes(t)) return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
  try {
    let records;
    switch (t) {
      case 'A':     records = await dns.resolve4(domain); break;
      case 'AAAA':  records = await dns.resolve6(domain); break;
      case 'CNAME': records = await dns.resolveCname(domain); break;
      case 'MX':    records = await dns.resolveMx(domain); break;
      case 'TXT':   records = (await dns.resolveTxt(domain)).map(r => r.join('')); break;
      case 'NS':    records = await dns.resolveNs(domain); break;
      default:      records = await dns.resolve(domain, t);
    }
    return res.json({ domain, type: t, records });
  } catch (err) {
    return res.status(404).json({ domain, type: t, error: err.message, code: err.code });
  }
});
