const pool = require("../database/connection");

async function barbeiroContexto(req, empresaId) {
  if (req.usuario?.tipo === 'barbeiro') return req.usuario.id;
  if (req.query?.barbeiro_id) return req.query.barbeiro_id;
  const r = await pool.query('SELECT barbeiro_principal_id FROM empresas WHERE id=$1',[empresaId]);
  return r.rows[0]?.barbeiro_principal_id || null;
}

async function listar(req, res) {
  try {
    const empresa = req.params.empresa;
    const barbeiroId = req.query.barbeiro_id || null;
    const planoQ = await pool.query('SELECT plano FROM empresas WHERE id=$1',[empresa]);
    const plano = String(planoQ.rows[0]?.plano || '').toLowerCase();
    const valores = barbeiroId ? [empresa, barbeiroId] : [empresa];
    const filtro = barbeiroId ? ' AND barbeiro_id=$2' : '';
    const limite = plano === 'bronze' ? ' LIMIT 4' : '';
    const resultado = await pool.query(`SELECT * FROM servicos WHERE empresa_id=$1 AND ativo=TRUE${filtro} ORDER BY created_at,id${limite}`, valores);
    res.json(resultado.rows);
  } catch (erro) { res.status(500).json({ erro: erro.message }); }
}

async function cadastrar(req, res) {
  try {
    const { empresa_id, nome, preco, duracao } = req.body;
    if (!empresa_id || !nome || Number(preco) <= 0 || Number(duracao) <= 0) return res.status(400).json({ erro: "Preencha nome, preço e duração." });
    const barbeiroId = await barbeiroContexto(req, empresa_id);
    if (!barbeiroId) return res.status(400).json({erro:'Perfil profissional não encontrado.'});
    const planoQ = await pool.query('SELECT plano FROM empresas WHERE id=$1',[empresa_id]);
    const plano = String(planoQ.rows[0]?.plano || '').toLowerCase();
    if (plano === 'bronze') {
      const totalQ = await pool.query('SELECT COUNT(*)::int total FROM servicos WHERE empresa_id=$1 AND barbeiro_id=$2',[empresa_id,barbeiroId]);
      if (Number(totalQ.rows[0]?.total || 0) >= 4) return res.status(409).json({erro:'O plano Bronze permite somente 4 serviços editáveis.'});
    }
    const resultado = await pool.query(`INSERT INTO servicos (empresa_id,barbeiro_id,nome,preco,duracao) VALUES ($1,$2,$3,$4,$5) RETURNING *`,[empresa_id,barbeiroId,nome,preco,duracao]);
    res.status(201).json(resultado.rows[0]);
  } catch (erro) { res.status(500).json({ erro: erro.message }); }
}

async function atualizar(req, res) {
  try {
    const { id } = req.params; const { nome, preco, duracao } = req.body;
    if (!nome || Number(preco) <= 0 || Number(duracao) <= 0) return res.status(400).json({ erro: "Preencha nome, preço e duração." });
    const barbeiroId = await barbeiroContexto(req, req.usuario.empresa_id);
    const resultado = await pool.query(`UPDATE servicos SET nome=$1,preco=$2,duracao=$3 WHERE id=$4 AND empresa_id=$5 AND barbeiro_id=$6 RETURNING *`,[nome,preco,duracao,id,req.usuario.empresa_id,barbeiroId]);
    if (!resultado.rows.length) return res.status(404).json({ erro: "Serviço não encontrado." });
    res.json(resultado.rows[0]);
  } catch (erro) { res.status(500).json({ erro: erro.message }); }
}

async function remover(req, res) {
  try {
    const planoQ = await pool.query('SELECT plano FROM empresas WHERE id=$1',[req.usuario.empresa_id]);
    if (String(planoQ.rows[0]?.plano || '').toLowerCase() === 'bronze') return res.status(403).json({erro:'No plano Bronze os 4 serviços são fixos e podem apenas ser editados.'});
    const barbeiroId = await barbeiroContexto(req, req.usuario.empresa_id);
    const r=await pool.query("DELETE FROM servicos WHERE id=$1 AND empresa_id=$2 AND barbeiro_id=$3 RETURNING id",[req.params.id,req.usuario.empresa_id,barbeiroId]);
    if(!r.rows[0]) return res.status(404).json({erro:'Serviço não encontrado.'});
    res.json({ mensagem: "Serviço removido com sucesso." });
  } catch (erro) { res.status(500).json({ erro: erro.message }); }
}
module.exports={listar,cadastrar,atualizar,remover};
