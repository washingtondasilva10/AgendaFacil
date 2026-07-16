const acessos = new Map();

function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

function rateLimit(req, res, next) {
  if (!req.path.startsWith('/auth') && req.method === 'GET') return next();
  const janelaMs = 60_000;
  const limite = req.path.startsWith('/auth') ? 20 : 120;
  const chave = `${req.ip}:${req.path.split('/').slice(0, 3).join('/')}`;
  const agora = Date.now();
  const registro = acessos.get(chave);
  if (!registro || agora - registro.inicio >= janelaMs) {
    acessos.set(chave, { inicio: agora, total: 1 });
    return next();
  }
  registro.total += 1;
  if (registro.total > limite) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde um minuto.' });
  next();
}

setInterval(() => {
  const limite = Date.now() - 120_000;
  for (const [chave, valor] of acessos) if (valor.inicio < limite) acessos.delete(chave);
}, 120_000).unref();

module.exports = { securityHeaders, rateLimit };
