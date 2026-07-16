const jwt = require('jsonwebtoken');

function extrairToken(req) {
  const cabecalho = String(req.headers.authorization || '');
  const [tipo, token] = cabecalho.split(' ');
  return tipo === 'Bearer' && token ? token : null;
}

function verificarToken(req, res, next) {
  const token = extrairToken(req);
  if (!token) return res.status(401).json({ erro: 'Acesso não autorizado. Faça login novamente.' });

  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch (_erro) {
    return res.status(401).json({ erro: 'Sessão inválida ou expirada. Faça login novamente.' });
  }
}

function exigirEmpresa(req, res, next) {
  const empresaSolicitada = req.params.empresa || req.body.empresa_id || req.query.empresa_id;
  if (!empresaSolicitada || String(empresaSolicitada) !== String(req.usuario.empresa_id)) {
    return res.status(403).json({ erro: 'Você não tem permissão para acessar dados desta barbearia.' });
  }
  return next();
}

function exigirAdministrador(req, res, next) {
  if (req.usuario.tipo !== 'administrador') {
    return res.status(403).json({ erro: 'Ação permitida apenas para o administrador da barbearia.' });
  }
  return next();
}

function exigirMaster(req, res, next) {
  if (req.usuario.tipo !== 'master') return res.status(403).json({ erro: 'Ação permitida apenas ao Control Center.' });
  return next();
}

module.exports = { verificarToken, exigirEmpresa, exigirAdministrador, exigirMaster };
