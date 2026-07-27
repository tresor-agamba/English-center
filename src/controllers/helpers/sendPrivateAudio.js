const fs = require('fs');

module.exports = function sendPrivateAudio(req, res, resource) {
  const { response, file } = resource;
  const commonHeaders = {
    'Content-Type': response.audioMimeType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
  };
  const range = req.headers.range;
  if (!range) {
    res.status(200).set({ ...commonHeaders, 'Content-Length': String(file.size) });
    return fs.createReadStream(file.absolutePath).pipe(res);
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return res.status(416).set('Content-Range', `bytes */${file.size}`).end();
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : file.size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= file.size) {
    return res.status(416).set('Content-Range', `bytes */${file.size}`).end();
  }
  res.status(206).set({
    ...commonHeaders,
    'Content-Range': `bytes ${start}-${end}/${file.size}`,
    'Content-Length': String(end - start + 1),
  });
  return fs.createReadStream(file.absolutePath, { start, end }).pipe(res);
};
