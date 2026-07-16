const pool = require('../database/connection');

function planoTemLoja(plano) { return ['ouro','combo'].includes(String(plano||'').toLowerCase()); }

async function barbeiroContexto(req) {
  if (req.usuario?.tipo === 'barbeiro') return req.usuario.id;
  if (req.query?.barbeiro_id) return req.query.barbeiro_id;
  const r=await pool.query('SELECT barbeiro_principal_id FROM empresas WHERE id=$1',[req.usuario.empresa_id]);
  return r.rows[0]?.barbeiro_principal_id || null;
}

async function obterPlano(empresaId) {
  const r = await pool.query('SELECT plano FROM empresas WHERE id=$1 AND status=\'ativo\'', [empresaId]);
  return r.rows[0]?.plano || null;
}
exports.listarPublico = async (req,res) => {
  try {
    const plano = await obterPlano(req.params.empresa);
    if (!planoTemLoja(plano)) return res.json([]);
    const barbeiroId = req.query.barbeiro || null;
    const valores = barbeiroId ? [req.params.empresa, barbeiroId] : [req.params.empresa];
    const filtroBarbeiro = barbeiroId ? ' AND barbeiro_id=$2' : '';
    const r = await pool.query(
      `SELECT id,nome,imagem,preco
       FROM produtos
       WHERE empresa_id=$1 AND ativo=TRUE${filtroBarbeiro}
       ORDER BY nome`,
      valores
    );
    res.json(r.rows);
  } catch(e){res.status(500).json({erro:e.message});}
};
exports.listar = async (req,res) => {
  try {
    const barbeiroId=await barbeiroContexto(req); const r=await pool.query('SELECT * FROM produtos WHERE empresa_id=$1 AND barbeiro_id=$2 ORDER BY ativo DESC,nome',[req.usuario.empresa_id,barbeiroId]); res.json(r.rows);
  } catch(e){res.status(500).json({erro:e.message});}
};
exports.criar = async (req,res) => {
  try {
    const plano=await obterPlano(req.usuario.empresa_id);
    if(!planoTemLoja(plano)) return res.status(403).json({erro:'Lojinha disponível apenas nos planos Ouro e Combo.'});
    const {nome,imagem,preco}=req.body;
    if(!nome || Number(preco)<0) return res.status(400).json({erro:'Nome e preço são obrigatórios.'});
    const r=await pool.query(
      `INSERT INTO produtos(empresa_id,barbeiro_id,nome,descricao,categoria,imagem,preco,estoque,estoque_minimo)
       VALUES($1,$2,$3,'','',$4,$5,1,0) RETURNING *`,
      [req.usuario.empresa_id,await barbeiroContexto(req),String(nome).trim(),imagem||'',Number(preco)]
    );
    res.status(201).json(r.rows[0]);
  } catch(e){res.status(500).json({erro:e.message});}
};
exports.atualizar = async (req,res) => {
  try {
    const {nome,imagem,preco,ativo}=req.body;
    const r=await pool.query(
      `UPDATE produtos SET nome=COALESCE($3,nome),imagem=COALESCE($4,imagem),preco=COALESCE($5,preco),ativo=COALESCE($6,ativo),atualizado_em=NOW()
       WHERE id=$1 AND empresa_id=$2 AND barbeiro_id=$7 RETURNING *`,
      [req.params.id,req.usuario.empresa_id,nome,imagem,preco,ativo,await barbeiroContexto(req)]
    );
    if(!r.rows[0]) return res.status(404).json({erro:'Produto não encontrado.'});
    res.json(r.rows[0]);
  } catch(e){res.status(500).json({erro:e.message});}
};
exports.remover = async (req,res) => {
  try {
    const r=await pool.query(
      `DELETE FROM produtos WHERE id=$1 AND empresa_id=$2 AND barbeiro_id=$3 RETURNING id`,
      [req.params.id,req.usuario.empresa_id,await barbeiroContexto(req)]
    );
    if(!r.rows[0]) return res.status(404).json({erro:'Produto não encontrado.'});
    res.json({mensagem:'Produto excluído.'});
  } catch(e){
    if(e.code==='23503') return res.status(409).json({erro:'Este produto já está ligado a um agendamento e não pode ser excluído. Desative-o.'});
    res.status(500).json({erro:e.message});
  }
};
exports.finalizarVenda = async (req,res) => {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const ag=await client.query(`SELECT id,empresa_id,barbeiro_id FROM agendamentos WHERE id=$1 AND empresa_id=$2 AND ($3::text='administrador' OR barbeiro_id=$4) FOR UPDATE`,[req.params.agendamento,req.usuario.empresa_id,req.usuario.tipo,req.usuario.id]);
    if(!ag.rows[0]) throw new Error('Agendamento não encontrado.');
    const itens=await client.query(`SELECT ap.*,p.nome FROM agendamento_produtos ap JOIN produtos p ON p.id=ap.produto_id WHERE ap.agendamento_id=$1 AND ap.empresa_id=$2 AND ap.status='reservado'`,[req.params.agendamento,req.usuario.empresa_id]);
    if(!itens.rows.length) throw new Error('Não há produtos reservados neste agendamento.');
    const total=itens.rows.reduce((s,i)=>s+Number(i.preco_unitario)*Number(i.quantidade),0);
    const venda=await client.query(`INSERT INTO vendas_loja(empresa_id,barbeiro_id,agendamento_id,total) VALUES($1,$2,$3,$4) RETURNING *`,[req.usuario.empresa_id,ag.rows[0].barbeiro_id,req.params.agendamento,total]);
    for(const i of itens.rows){
      await client.query('INSERT INTO venda_itens(empresa_id,venda_id,produto_id,nome_produto,quantidade,preco_unitario) VALUES($6,$1,$2,$3,$4,$5)',[venda.rows[0].id,i.produto_id,i.nome,i.quantidade,i.preco_unitario,req.usuario.empresa_id]);
    }
    await client.query("UPDATE agendamento_produtos SET status='concluido' WHERE agendamento_id=$1 AND empresa_id=$2 AND status='reservado'",[req.params.agendamento,req.usuario.empresa_id]);
    await client.query('COMMIT'); res.json(venda.rows[0]);
  } catch(e){await client.query('ROLLBACK');res.status(400).json({erro:e.message});} finally{client.release();}
};
exports.cancelarReserva = async (req,res) => {
  try { const status=req.body.status==='nao_levou'?'nao_levou':'cancelado'; await pool.query("UPDATE agendamento_produtos SET status=$3 WHERE agendamento_id=$1 AND empresa_id=$2 AND status='reservado'",[req.params.agendamento,req.usuario.empresa_id,status]); res.json({mensagem:'Reserva atualizada.'}); } catch(e){res.status(500).json({erro:e.message});}
};
exports.financeiro=async(req,res)=>{try{const data=req.query.data;const barbeiroId=await barbeiroContexto(req);const r=await pool.query(`SELECT COALESCE(SUM(total),0) total,COUNT(*) quantidade FROM vendas_loja WHERE empresa_id=$1 AND status='concluida' AND ($2::date IS NULL OR criado_em::date=$2::date) AND barbeiro_id=$3`,[req.usuario.empresa_id,data||null,barbeiroId]);res.json(r.rows[0]);}catch(e){res.status(500).json({erro:e.message});}};
