'use strict';
/* Vercel adapter for server/referral-share-core.js. Reached through the /r/:code rewrites in vercel.json. */
const { handle } = require('../server/referral-share-core.js');

module.exports = async (req, res) => {
  const q = req.query || {};
  const r = await handle({ code: String(q.code || ''), img: q.img === '1' });
  Object.keys(r.headers).forEach((k) => res.setHeader(k, r.headers[k]));
  res.status(r.status).send(r.body);
};
