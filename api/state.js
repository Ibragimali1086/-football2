// Vercel serverless function: saytın məlumatını saxlayır və oxuyur.
// GET  -> hamı oxuya bilər
// POST -> yalnız düzgün admin parolu ilə yazmaq olar
const crypto = require('crypto');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'ftm:state';

async function redis(cmd) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'redis_error');
  return j.result;
}

function isAdmin(req) {
  const pw = process.env.ADMIN_PASSWORD;
  const given = String(req.headers['x-admin-password'] || '');
  if (!pw || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(pw).digest();
  return crypto.timingSafeEqual(a, b);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async (req, res) => {
  const send = (code, obj) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(obj));
  };

  if (!REDIS_URL || !REDIS_TOKEN || !process.env.ADMIN_PASSWORD) {
    return send(500, { error: 'not_configured' });
  }

  try {
    if (req.method === 'GET') {
      const state = await redis(['GET', KEY]);
      return send(200, { state: state || null, admin: isAdmin(req) });
    }

    if (req.method === 'POST') {
      if (!isAdmin(req)) {
        await sleep(600); // parol təxminini yavaşladır
        return send(401, { error: 'unauthorized' });
      }
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
      let state = body && body.state;
      if (typeof state !== 'string') return send(400, { error: 'bad_body' });
      if (state.length > 900000) return send(413, { error: 'too_large' });
      let parsed;
      try { parsed = JSON.parse(state); } catch (e) { return send(400, { error: 'bad_json' }); }
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.players)) {
        return send(400, { error: 'bad_state' });
      }
      await redis(['SET', KEY, state]);
      return send(200, { ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return send(405, { error: 'method_not_allowed' });
  } catch (e) {
    return send(500, { error: 'server_error' });
  }
};
