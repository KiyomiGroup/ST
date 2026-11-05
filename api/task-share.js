'use strict';
/* Vercel adapter for server/task-share-core.js. Reached through the /t/:id rewrites in vercel.json. */
const { handle } = require('../server/task-share-core.js');

module.exports = async (req, res) => {
  const q = req.query || {};
  const r = await handle({ id: String(q.id || ''), img: q.img === '1' });
  Object.keys(r.headers).forEach((k) => res.setHeader(k, r.headers[k]));
  res.status(r.status).send(r.body);
};
