const pool = require('../database/connection');
const { enviarNotificacaoAgendamento, enviarConfirmacaoCliente } = require('../services/whatsapp.service');

const STATUS = Object.freeze({
  AGENDADO: 'agendado',
  CONCLUIDO: 'concluido',
  NAO_COMPARECEU: 'nao_compareceu',
  CANCELADO: 'cancelado'
});

function filtroBarbeiro(barbeiroId, inicio = 2) {
  if (!barbeiroId) return { sql: '', valores: [] };
  return { sql: ` AND a.barbeiro_id = $${inicio}`, valores: [barbeiroId] };
}

async function listar(req, res) {
  try {
    const empresa = req.params.empresa;
    let barbeiroId = req.usuario.tipo === 'barbeiro' ? req.usuario.id : (req.query.barbeiro_id || null);
    if(!barbeiroId && req.usuario.tipo==='administrador'){const q=await pool.query('SELECT barbeiro_principal_id FROM empresas WHERE id=$1',[req.usuario.empresa_id]);barbeiroId=q.rows[0]?.barbeiro_principal_id||null;}
    const filtro = filtroBarbeiro(barbeiroId);

    const resultado = await pool.query(
      `SELECT a.*, s.nome AS servico_nome, s.preco, s.duracao, b.nome AS barbeiro_nome,
       COALESCE((SELECT json_agg(json_build_object('id',ap.id,'produto_id',ap.produto_id,'nome',p.nome,'quantidade',ap.quantidade,'preco_unitario',ap.preco_unitario,'status',ap.status)) FROM agendamento_produtos ap JOIN produtos p ON p.id=ap.produto_id WHERE ap.agendamento_id=a.id),'[]'::json) AS produtos
       FROM agendamentos a
       LEFT JOIN servicos s ON s.id = a.servico_id
       LEFT JOIN barbeiros b ON b.id = a.barbeiro_id
       WHERE a.empresa_id = $1${filtro.sql}
       ORDER BY a.data, a.hora`,
      [empresa, ...filtro.valores]
    );

    res.json(resultado.rows);
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
}

async function cadastrar(req, res) {
  try {
    const { empresa_id, barbeiro_id, servico_id, cliente, whatsapp, data, hora, produtos = [] } = req.body;

    if (!empresa_id || !barbeiro_id || !servico_id || !cliente || !whatsapp || !data || !hora) {
      return res.status(400).json({ erro: 'Dados do agendamento incompletos' });
    }

    const dataAgendamento = String(data).substring(0, 10);
    const horaAgendamento = String(hora).substring(0, 5);
    const agoraBrasil = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date());
    const [dataBrasil, horaBrasil] = agoraBrasil.split(' ');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataAgendamento) || !/^\d{2}:\d{2}$/.test(horaAgendamento) ||
        dataAgendamento < dataBrasil || (dataAgendamento === dataBrasil && horaAgendamento <= horaBrasil)) {
      return res.status(409).json({ erro: 'Esse horário já passou. Escolha outro horário.' });
    }

    const barbeiro = await pool.query(
      `SELECT id, nome, ativo, whatsapp_notificacoes FROM barbeiros WHERE id=$1 AND empresa_id=$2`,
      [barbeiro_id, empresa_id]
    );

    if (!barbeiro.rows[0] || !barbeiro.rows[0].ativo) {
      return res.status(400).json({ erro: 'Barbeiro inválido ou inativo' });
    }

    const servico = await pool.query(
      `SELECT id, nome, preco, duracao FROM servicos WHERE id=$1 AND empresa_id=$2`,
      [servico_id, empresa_id]
    );

    if (!servico.rows[0]) {
      return res.status(400).json({ erro: 'Serviço inválido' });
    }

    const conflito = await pool.query(
      `SELECT a.id FROM agendamentos a
       JOIN servicos s ON s.id = a.servico_id
       WHERE a.empresa_id=$1 AND a.barbeiro_id=$2 AND a.data=$3
         AND a.status=$6
         AND ($4::time < (a.hora + (s.duracao || ' minutes')::interval)::time)
         AND (($4::time + ($5 || ' minutes')::interval)::time > a.hora)`,
      [empresa_id, barbeiro_id, data, hora, servico.rows[0].duracao, STATUS.AGENDADO]
    );

    if (conflito.rows.length) {
      return res.status(409).json({ erro: 'Horário já agendado para este barbeiro' });
    }

    const bloqueado = await pool.query(
      `SELECT id FROM horarios_bloqueados
       WHERE empresa_id=$1 AND barbeiro_id=$2 AND data=$3
         AND hora >= $4::time
         AND hora < ($4::time + ($5 || ' minutes')::interval)::time`,
      [empresa_id, barbeiro_id, data, hora, servico.rows[0].duracao]
    );

    if (bloqueado.rows.length) {
      return res.status(409).json({ erro: 'Horário bloqueado pelo barbeiro' });
    }

    const client = await pool.connect();
    let resultado;
    try {
      await client.query('BEGIN');
      resultado = await client.query(
        `INSERT INTO agendamentos
         (empresa_id, barbeiro_id, servico_id, cliente, whatsapp, data, hora, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [empresa_id, barbeiro_id, servico_id, cliente, whatsapp, data, hora, STATUS.AGENDADO]
      );
      const planoQ = await client.query('SELECT plano FROM empresas WHERE id=$1', [empresa_id]);
      const permiteLoja = ['ouro','combo'].includes(String(planoQ.rows[0]?.plano||'').toLowerCase());
      if (permiteLoja && Array.isArray(produtos)) {
        for (const item of produtos) {
          const produto = await client.query('SELECT id,preco,ativo FROM produtos WHERE id=$1 AND empresa_id=$2', [item.produto_id, empresa_id]);
          if (!produto.rows[0] || !produto.rows[0].ativo) throw new Error('Produto indisponível.');
          await client.query(`INSERT INTO agendamento_produtos(empresa_id,agendamento_id,produto_id,quantidade,preco_unitario) VALUES($1,$2,$3,1,$4)`, [empresa_id,resultado.rows[0].id,item.produto_id,produto.rows[0].preco]);
        }
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }

    const empresa = await pool.query(
      `SELECT nome, whatsapp_notificacoes, telefone, plano FROM empresas WHERE id=$1`,
      [empresa_id]
    );

    const produtosAgendamento = await pool.query(
      `SELECT p.nome, ap.quantidade
       FROM agendamento_produtos ap
       JOIN produtos p ON p.id=ap.produto_id
       WHERE ap.agendamento_id=$1 AND ap.empresa_id=$2
       ORDER BY p.nome`,
      [resultado.rows[0].id, empresa_id]
    );

    const produtosResumo = produtosAgendamento.rows.length
      ? produtosAgendamento.rows
          .map((item) => item.nome)
          .join(', ')
      : 'Nenhum';

    const destino = barbeiro.rows[0]?.whatsapp_notificacoes || empresa.rows[0]?.whatsapp_notificacoes || empresa.rows[0]?.telefone;
    const notificacao = await enviarNotificacaoAgendamento({
      destino,
      agendamento: resultado.rows[0],
      servicoNome: servico.rows[0].nome,
      servicoPreco: servico.rows[0].preco,
      produtosResumo
    }).catch((erro) => ({ enviado: false, motivo: erro.message }));

    if (!notificacao.enviado) {
      console.error('Falha ao notificar o barbeiro no WhatsApp:', notificacao);
    }

    const confirmacaoCliente = await enviarConfirmacaoCliente({
      destino: whatsapp,
      empresaNome: empresa.rows[0]?.nome,
      agendamento: resultado.rows[0],
      servicoNome: servico.rows[0].nome
    }).catch((erro) => ({ enviado: false, motivo: erro.message }));

    res.status(201).json({ ...resultado.rows[0], notificacao, confirmacaoCliente });
  } catch (erro) {
    const mensagem = erro.message || 'Não foi possível criar o agendamento.';
    const status = /indisponível|quantidade|Estoque|conflito|bloqueado/i.test(mensagem) ? 409 : 500;
    res.status(status).json({ erro: mensagem });
  }
}

async function atualizarStatus(req, res, status) {
  try {
    let barbeiroContextoId=req.usuario.id;
    if(req.usuario.tipo==='administrador'){const q=await pool.query('SELECT barbeiro_principal_id FROM empresas WHERE id=$1',[req.usuario.empresa_id]);barbeiroContextoId=q.rows[0]?.barbeiro_principal_id;}
    const resultado = await pool.query(
      `UPDATE agendamentos SET status=$2, atualizado_em=NOW() WHERE id=$1 AND empresa_id=$3 AND barbeiro_id=$4 RETURNING *`,
      [req.params.id, status, req.usuario.empresa_id, barbeiroContextoId]
    );

    if (!resultado.rows[0]) {
      return res.status(404).json({ erro: 'Agendamento não encontrado' });
    }

    if(status===STATUS.CONCLUIDO){
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const existe=await client.query('SELECT id FROM vendas_loja WHERE agendamento_id=$1',[resultado.rows[0].id]);
        if(!existe.rows[0]){
          const itens=await client.query(`SELECT ap.*,p.nome FROM agendamento_produtos ap JOIN produtos p ON p.id=ap.produto_id WHERE ap.agendamento_id=$1 AND ap.empresa_id=$2 AND ap.status='reservado'`,[resultado.rows[0].id,req.usuario.empresa_id]);
          if(itens.rows.length){
            const total=itens.rows.reduce((s,i)=>s+Number(i.preco_unitario),0);
            const venda=await client.query(`INSERT INTO vendas_loja(empresa_id,barbeiro_id,agendamento_id,total,status) VALUES($1,$2,$3,$4,'concluida') RETURNING id`,[req.usuario.empresa_id,resultado.rows[0].barbeiro_id,resultado.rows[0].id,total]);
            for(const i of itens.rows) await client.query(`INSERT INTO venda_itens(empresa_id,venda_id,produto_id,nome_produto,quantidade,preco_unitario) VALUES($1,$2,$3,$4,1,$5)`,[req.usuario.empresa_id,venda.rows[0].id,i.produto_id,i.nome,i.preco_unitario]);
            await client.query("UPDATE agendamento_produtos SET status='concluido' WHERE agendamento_id=$1 AND empresa_id=$2 AND status='reservado'",[resultado.rows[0].id,req.usuario.empresa_id]);
          }
        }
        await client.query('COMMIT');
      }catch(e){await client.query('ROLLBACK');console.error('Falha ao lançar lojinha no financeiro:',e.message);}finally{client.release();}
    }

    res.json(resultado.rows[0]);
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
}

function concluir(req, res) {
  return atualizarStatus(req, res, STATUS.CONCLUIDO);
}

function naoCompareceu(req, res) {
  return atualizarStatus(req, res, STATUS.NAO_COMPARECEU);
}

function cancelar(req, res) {
  return atualizarStatus(req, res, STATUS.CANCELADO);
}


async function disponibilidade(req, res) {
  try {
    const empresa = req.params.empresa;
    const barbeiroId = req.query.barbeiro_id || null;
    const valores = [empresa];
    let filtro = '';
    if (barbeiroId) { valores.push(barbeiroId); filtro = ' AND a.barbeiro_id=$2'; }
    const resultado = await pool.query(
      `SELECT a.data, a.hora, a.barbeiro_id, a.status, s.duracao
       FROM agendamentos a JOIN servicos s ON s.id=a.servico_id
       WHERE a.empresa_id=$1 AND a.status='agendado'${filtro}
       ORDER BY a.data, a.hora`, valores
    );
    res.json(resultado.rows);
  } catch (erro) { res.status(500).json({ erro: erro.message }); }
}
module.exports = {
  STATUS,
  listar,
  disponibilidade,
  cadastrar,
  concluir,
  naoCompareceu,
  cancelar
};
