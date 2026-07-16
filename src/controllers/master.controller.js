const pool = require('../database/connection');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

async function login(req, res) {
  try {
    const usuario = String(req.body.usuario || '').trim().toLowerCase();
    const senha = String(req.body.senha || '');
    if (!usuario || !senha) return res.status(400).json({ erro: 'Informe usuário e senha.' });

    const r = await pool.query('SELECT id,nome,usuario,senha,ativo FROM usuarios_master WHERE LOWER(usuario)=LOWER($1) LIMIT 1', [usuario]);
    const conta = r.rows[0];
    if (!conta || !conta.ativo || !(await bcrypt.compare(senha, conta.senha))) {
      return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
    }
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET não configurado.');
    const token = jwt.sign({ id: conta.id, nome: conta.nome, tipo: 'master' }, process.env.JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, usuario: { id: conta.id, nome: conta.nome, usuario: conta.usuario, tipo: 'master' } });
  } catch (e) { res.status(500).json({ erro: 'Falha no login Master.', detalhe: e.message }); }
}

async function perfil(req, res) {
  res.json({ usuario: req.usuario });
}

async function alterarSenha(req, res) {
  try {
    const atual = String(req.body.senha_atual || '');
    const nova = String(req.body.nova_senha || '');
    if (nova.length < 6) return res.status(400).json({ erro: 'A nova senha deve ter pelo menos 6 caracteres.' });
    const r = await pool.query('SELECT senha FROM usuarios_master WHERE id=$1', [req.usuario.id]);
    if (!r.rows[0] || !(await bcrypt.compare(atual, r.rows[0].senha))) return res.status(401).json({ erro: 'Senha atual incorreta.' });
    await pool.query('UPDATE usuarios_master SET senha=$1,atualizado_em=NOW() WHERE id=$2', [await bcrypt.hash(nova, 12), req.usuario.id]);
    res.json({ mensagem: 'Senha alterada.' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
}

module.exports = { login, perfil, alterarSenha };
