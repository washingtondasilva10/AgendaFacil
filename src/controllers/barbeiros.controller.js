const pool = require('../database/connection');
const bcrypt = require('bcryptjs');

async function listarPublico(req, res) {
  try {
    const empresa = await pool.query('SELECT plano,status,vencimento FROM empresas WHERE id=$1',[req.params.empresa]);
    const e=empresa.rows[0];
    if(!e||e.status!=='ativo') return res.json([]);
    const limite=String(e.plano).toLowerCase()==='combo'?'':' LIMIT 1';
    const resultado=await pool.query(`SELECT id,nome FROM barbeiros WHERE empresa_id=$1 AND ativo=TRUE ORDER BY created_at${limite}`,[req.params.empresa]);
    res.json(resultado.rows);
  } catch(erro){res.status(500).json({erro:erro.message});}
}

async function listar(req, res) {
  try {
    const resultado = await pool.query(
      `SELECT id, empresa_id, nome, ativo, usuario, whatsapp_notificacoes FROM barbeiros WHERE empresa_id = $1 ORDER BY nome`,
      [req.params.empresa]
    );
    res.json(resultado.rows);
  } catch (erro) { res.status(500).json({ erro: erro.message }); }
}

async function obter(req, res) {
  try {
    const resultado = await pool.query(
      `SELECT id, empresa_id, nome, ativo, usuario, whatsapp_notificacoes FROM barbeiros WHERE id = $1 AND empresa_id = $2`,
      [req.params.id, req.params.empresa]
    );
    if (!resultado.rows[0]) return res.status(404).json({ erro: 'Barbeiro não encontrado' });
    res.json(resultado.rows[0]);
  } catch (erro) { res.status(500).json({ erro: erro.message }); }
}

async function cadastrar(req, res) {
  const client = await pool.connect();
  try {
    const { empresa_id, nome, usuario, senha } = req.body;
    if (!empresa_id || !nome) return res.status(400).json({ erro: 'Empresa e nome são obrigatórios' });
    await client.query('BEGIN');
    const empresaQ = await client.query('SELECT plano,limite_equipe FROM empresas WHERE id=$1 FOR UPDATE',[empresa_id]);
    const empresa = empresaQ.rows[0];
    if(!empresa){await client.query('ROLLBACK');return res.status(404).json({erro:'Barbearia não encontrada'});}
    const totalQ = await client.query('SELECT COUNT(*)::int total FROM barbeiros WHERE empresa_id=$1',[empresa_id]);
    const total = Number(totalQ.rows[0].total||0);
    if(total>=1){
      if(String(empresa.plano).toLowerCase()!=='combo'){await client.query('ROLLBACK');return res.status(403).json({erro:'Equipe disponível somente no plano Combo.'});}
      const limite=Math.max(1,Number(empresa.limite_equipe||1));
      if((total-1)>=limite){await client.query('ROLLBACK');return res.status(409).json({erro:`Limite de ${limite} barbeiros adicionais atingido.`});}
    }
    const senhaProtegida = senha ? await bcrypt.hash(String(senha), 12) : null;
    const resultado = await client.query(`INSERT INTO barbeiros (empresa_id,nome,ativo,usuario,senha) VALUES ($1,$2,true,$3,$4) RETURNING id,empresa_id,nome,ativo,usuario,whatsapp_notificacoes`,[empresa_id,nome,usuario||null,senhaProtegida]);
    const principal = await client.query('SELECT barbeiro_principal_id FROM empresas WHERE id=$1',[empresa_id]);
    if (principal.rows[0]?.barbeiro_principal_id) {
      const clonados = await client.query(`INSERT INTO servicos(empresa_id,barbeiro_id,nome,preco,duracao,ativo)
        SELECT empresa_id,$1,nome,preco,duracao,ativo FROM servicos
        WHERE empresa_id=$2 AND barbeiro_id=$3 RETURNING id`,[resultado.rows[0].id,empresa_id,principal.rows[0].barbeiro_principal_id]);
      if (!clonados.rows.length) {
        const padroes=[['Corte',30,40],['Barba',20,20],['Sobrancelha',10,10],['Corte + Barba',45,60]];
        for (const [sn,preco,duracao] of padroes) await client.query('INSERT INTO servicos(empresa_id,barbeiro_id,nome,preco,duracao,ativo) VALUES($1,$2,$3,$4,$5,true)',[empresa_id,resultado.rows[0].id,sn,preco,duracao]);
      }
    }
    await client.query('COMMIT');
    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    await client.query('ROLLBACK');
    res.status(500).json({ erro: erro.code==='23505'?'Esse usuário já está cadastrado.':erro.message });
  } finally { client.release(); }
}

async function atualizar(req, res) {
  try {
    const { nome, ativo, usuario, senha } = req.body;
    const senhaProtegida = senha ? await bcrypt.hash(String(senha), 12) : null;
    const resultado = await pool.query(
      `UPDATE barbeiros SET
       nome=COALESCE($1,nome), ativo=COALESCE($2,ativo), usuario=COALESCE($3,usuario), senha=COALESCE($4,senha)
       WHERE id=$5 AND empresa_id=$6 RETURNING id, empresa_id, nome, ativo, usuario`,
      [nome || null, ativo === undefined ? null : ativo, usuario || null, senhaProtegida, req.params.id, req.usuario.empresa_id]
    );
    if (!resultado.rows[0]) return res.status(404).json({ erro: 'Barbeiro não encontrado' });
    res.json(resultado.rows[0]);
  } catch (erro) { res.status(500).json({ erro: erro.message }); }
}

async function remover(req, res) {
  try {
    await pool.query('DELETE FROM barbeiros WHERE id=$1 AND empresa_id=$2', [req.params.id, req.usuario.empresa_id]);
    res.json({ mensagem: 'Barbeiro removido' });
  } catch (erro) { res.status(500).json({ erro: erro.message }); }
}

async function obterMeuPerfil(req, res) {
  try {
    if (req.usuario.tipo !== 'barbeiro') return res.status(403).json({ erro: 'Acesso exclusivo do barbeiro.' });
    const r = await pool.query('SELECT id,empresa_id,nome,usuario,whatsapp_notificacoes,ativo FROM barbeiros WHERE id=$1 AND empresa_id=$2', [req.usuario.id, req.usuario.empresa_id]);
    if (!r.rows[0]) return res.status(404).json({ erro: 'Perfil não encontrado.' });
    res.json(r.rows[0]);
  } catch (erro) { res.status(500).json({ erro: erro.message }); }
}

async function atualizarMeuPerfil(req, res) {
  try {
    if (req.usuario.tipo !== 'barbeiro') return res.status(403).json({ erro: 'Acesso exclusivo do barbeiro.' });
    const nome = String(req.body.nome || '').trim();
    const whatsapp = String(req.body.whatsapp_notificacoes || '').trim();
    if (!nome) return res.status(400).json({ erro: 'Informe seu nome.' });
    const r = await pool.query(`UPDATE barbeiros SET nome=$1,whatsapp_notificacoes=$2 WHERE id=$3 AND empresa_id=$4 RETURNING id,empresa_id,nome,usuario,whatsapp_notificacoes,ativo`, [nome, whatsapp || null, req.usuario.id, req.usuario.empresa_id]);
    if (!r.rows[0]) return res.status(404).json({ erro: 'Perfil não encontrado.' });
    res.json(r.rows[0]);
  } catch (erro) { res.status(500).json({ erro: erro.message }); }
}

module.exports = { listarPublico, listar, obter, cadastrar, atualizar, remover, obterMeuPerfil, atualizarMeuPerfil };
