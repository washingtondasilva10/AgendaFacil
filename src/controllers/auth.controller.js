const pool = require('../database/connection');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

async function validarSenha(senhaInformada, senhaSalva, tabela, id) {
  if (!senhaSalva) return false;
  if (String(senhaSalva).startsWith('$2')) return bcrypt.compare(senhaInformada, senhaSalva);
  const correta = senhaInformada === senhaSalva;
  if (correta) {
    const hash = await bcrypt.hash(senhaInformada, 12);
    await pool.query(`UPDATE ${tabela} SET senha=$1 WHERE id=$2`, [hash, id]);
  }
  return correta;
}

async function login(req, res) {
  try {
    const identificador = String(req.body.identificador || req.body.email || req.body.usuario || '').trim().toLowerCase();
    const senha = String(req.body.senha || '');
    if (!identificador || !senha) return res.status(400).json({ erro: 'Informe usuário/e-mail e senha.' });

    let resultado = await pool.query(
      `SELECT a.id, a.empresa_id, a.nome, a.email AS identificador, a.senha, a.ativo,
              e.nome AS empresa_nome, e.status AS empresa_status, e.plano, e.logo, e.whatsapp_notificacoes, e.limite_equipe, e.barbeiro_principal_id, e.vencimento
       FROM administradores a JOIN empresas e ON e.id=a.empresa_id
       WHERE LOWER(COALESCE(a.usuario,''))=LOWER($1) OR LOWER(COALESCE(a.email,''))=LOWER($1) LIMIT 1`, [identificador]
    );
    let usuario = resultado.rows[0];
    let tipo = 'administrador';
    let tabela = 'administradores';

    if (!usuario) {
      resultado = await pool.query(
        `SELECT b.id, b.empresa_id, b.nome, b.usuario AS identificador, b.senha, b.ativo,
                e.nome AS empresa_nome, e.status AS empresa_status, e.plano, e.logo, COALESCE(b.whatsapp_notificacoes,e.whatsapp_notificacoes) AS whatsapp_notificacoes, e.limite_equipe, e.barbeiro_principal_id, e.vencimento
         FROM barbeiros b JOIN empresas e ON e.id=b.empresa_id
         WHERE LOWER(b.usuario)=LOWER($1) LIMIT 1`, [identificador]
      );
      usuario = resultado.rows[0];
      tipo = 'barbeiro';
      tabela = 'barbeiros';
    }

    if (!usuario || !(await validarSenha(senha, usuario.senha, tabela, usuario.id))) {
      return res.status(401).json({ erro: 'Usuário/e-mail ou senha incorretos.' });
    }
    if (!usuario.ativo) return res.status(403).json({ erro: 'Este acesso está bloqueado.' });
    if (usuario.empresa_status !== 'ativo') return res.status(403).json({ erro: 'O sistema desta barbearia está bloqueado.' });
    if (usuario.vencimento && String(usuario.vencimento).slice(0,10) < new Date().toISOString().slice(0,10)) return res.status(403).json({ erro: 'A licença desta barbearia está vencida.' });
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET não configurado no servidor.');

    const token = jwt.sign({ id: usuario.id, empresa_id: usuario.empresa_id, nome: usuario.nome, tipo }, process.env.JWT_SECRET, { expiresIn: '12h' });
    res.json({
      mensagem: 'Login realizado com sucesso', token,
      usuario: { id: usuario.id, empresa_id: usuario.empresa_id, nome: usuario.nome, identificador: usuario.identificador, tipo },
      empresa: { id: usuario.empresa_id, nome: usuario.empresa_nome, status: usuario.empresa_status, plano: usuario.plano, logo: usuario.logo, whatsapp_notificacoes: usuario.whatsapp_notificacoes, limite_equipe: usuario.limite_equipe, barbeiro_principal_id: usuario.barbeiro_principal_id }
    });
  } catch (erro) { res.status(500).json({ erro: 'Não foi possível realizar o login.', detalhe: erro.message }); }
}

function perfil(req, res) { res.json({ usuario: req.usuario }); }

async function alterarSenha(req,res){
  try{
    const nova=String(req.body.nova_senha||'');
    if(nova.length<6)return res.status(400).json({erro:'A senha deve ter pelo menos 6 caracteres.'});
    const tabela=req.usuario.tipo==='barbeiro'?'barbeiros':'administradores';
    const hash=await bcrypt.hash(nova,12);
    const r=await pool.query(`UPDATE ${tabela} SET senha=$1 WHERE id=$2 AND empresa_id=$3 RETURNING id`,[hash,req.usuario.id,req.usuario.empresa_id]);
    if(!r.rows[0])return res.status(404).json({erro:'Usuário não encontrado.'});
    res.json({mensagem:'Senha alterada.'});
  }catch(e){res.status(500).json({erro:e.message});}
}

module.exports = { login, perfil, alterarSenha };
