module.exports = async function handler(req, res) {
  console.log('ChessBase webhook received', {
    method: req.method,
    url: req.url,
  });

  res.status(200).json({ ok: true });
};
