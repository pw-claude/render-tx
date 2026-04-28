import express        from 'express';
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
const CM_SMTP_HOST = 'smtp.transactional.createsend.com';
const SMTP_PORTS   = [
  { port: 2525, secure: false, requireTLS: true  },
  { port: 465,  secure: true,  requireTLS: false },
  { port: 587,  secure: false, requireTLS: true  },
];

async function trySend(smtpToken, mailOptions, portConfig) {
  const transporter = nodemailer.createTransport({
    host:               CM_SMTP_HOST,
    port:               portConfig.port,
    secure:             portConfig.secure,
    requireTLS:         portConfig.requireTLS,
    auth:               { user: smtpToken, pass: smtpToken },
    connectionTimeout:  10000,
    greetingTimeout:    10000,
    socketTimeout:      15000,
  });
  return transporter.sendMail(mailOptions);
}

app.post('/api/smtp', async (req, res) => {
  const { smtpToken, from, to, cc, bcc, replyTo, subject, html, text } = req.body || {};
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

  const attempts = [];
  for (const portConfig of SMTP_PORTS) {
    try {
      const info = await trySend(smtpToken, mailOptions, portConfig);
      return res.status(200).json({
        success: true, port_used: portConfig.port,
        messageId: info.messageId, accepted: info.accepted,
        rejected: info.rejected, response: info.response,
      });
    } catch (err) {
      attempts.push({ port: portConfig.port, error: err.message, code: err.code || null });
      if (err.responseCode === 535 || err.code === 'EAUTH') {
        return res.status(401).json({
          error: 'SMTP authentication failed — check your SMTP Token', attempts,
        });
      }
    }
  }
  return res.status(502).json({
    error: 'SMTP send failed on all ports (2525, 465, 587)',
    detail: 'All connection attempts timed out.',
    attempts,
  });
});

// ── GET /api/diag ─────────────────────────────────────────────────────────────
// Runs DNS + TCP probes against CM SMTP host and returns a report.
// Hit this in your browser: https://your-render-url.onrender.com/api/diag
app.get('/api/diag', diagHandler);

// ── Catch-all SPA ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`CM Tester running on http://localhost:${PORT}`));
