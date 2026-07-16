const pool = require('../database/connection');
const bcrypt = require('bcryptjs');
const { enviarMensagemTexto } = require('../services/whatsapp.service');

const PLANOS = ['bronze','prata','ouro','combo'];
function planoValido(p) { return PLANOS.includes(String(p || '').toLowerCase()); }

async function criarEmpresa(req, res) {
  const client = await pool.connect();
  try {
    const { nome, telefone, email, logo, whatsapp_notificacoes, plano='bronze', vencimento, usuario, senha, nome_administrador, limite_equipe=0 } = req.body;
    if (!nome || !usuario || !senha) return res.status(400).json({ erro: 'Nome, usuário e senha inicial são obrigatórios.' });
    if (!planoValido(plano)) return res.status(400).json({ erro: 'Plano inválido.' });
    const limiteEquipe = String(plano).toLowerCase()==='combo' ? Math.min(50, Math.max(1, Number(limite_equipe)||1)) : 0;
    await client.query('BEGIN');
    const empresa = await client.query(`INSERT INTO empresas (nome,telefone,email,logo,whatsapp_notificacoes,plano,vencimento,status,limite_equipe)
      VALUES($1,$2,$3,$4,$5,$6,$7,'ativo',$8) RETURNING *`, [nome,telefone||null,email||null,logo||null,whatsapp_notificacoes||telefone||null,plano,vencimento||null,limiteEquipe]);
    const empresaId = empresa.rows[0].id;
    const hash = await bcrypt.hash(String(senha), 12);
    const admin = await client.query(`INSERT INTO administradores(empresa_id,nome,email,usuario,senha) VALUES($1,$2,$3,$4,$5)
      RETURNING id,empresa_id,nome,email,usuario`, [empresaId,nome_administrador||nome,email||null,usuario,hash]);
    const barbeiro = await client.query(`INSERT INTO barbeiros(empresa_id,nome,usuario,senha,ativo) VALUES($1,$2,$3,$4,TRUE)
      RETURNING id,empresa_id,nome,usuario,ativo`, [empresaId,nome_administrador||nome,`${usuario}-barbeiro`,hash]);
    await client.query('UPDATE empresas SET barbeiro_principal_id=$1 WHERE id=$2', [barbeiro.rows[0].id, empresaId]);
    empresa.rows[0].barbeiro_principal_id = barbeiro.rows[0].id;
    for (const [sn,preco,duracao] of [['Corte',30,40],['Barba',20,20],['Sobrancelha',10,10],['Combo Corte + Barba',50,60]]) {
      await client.query('INSERT INTO servicos(empresa_id,barbeiro_id,nome,preco,duracao) VALUES($1,$2,$3,$4,$5)', [empresaId,barbeiro.rows[0].id,sn,preco,duracao]);
    }
    await client.query('INSERT INTO configuracoes_empresa(empresa_id) VALUES($1) ON CONFLICT DO NOTHING', [empresaId]);
    await client.query('COMMIT');
    res.status(201).json({ ...empresa.rows[0], administrador: admin.rows[0], barbeiro_principal: barbeiro.rows[0] });
  } catch (erro) {
    await client.query('ROLLBACK');
    const msg = erro.code === '23505' ? 'Esse usuário já está cadastrado.' : erro.message;
    res.status(500).json({ erro: msg });
  } finally { client.release(); }
}

async function listarEmpresas(_req,res){
  try {
    const r=await pool.query(`
      SELECT e.*,
        a.usuario AS usuario_administrador,
        a.nome AS nome_administrador,
        (SELECT COUNT(*)::int FROM barbeiros b WHERE b.empresa_id=e.id) AS usuarios_cadastrados,
        (SELECT COUNT(*)::int FROM barbeiros b WHERE b.empresa_id=e.id AND b.ativo) AS usuarios_ativos,
        (SELECT COUNT(*)::int FROM barbeiros b WHERE b.empresa_id=e.id AND b.id IS DISTINCT FROM e.barbeiro_principal_id) AS membros_equipe,
        (SELECT COUNT(*)::int FROM barbeiros b WHERE b.empresa_id=e.id AND b.id IS DISTINCT FROM e.barbeiro_principal_id AND b.ativo) AS membros_equipe_ativos
      FROM empresas e
      LEFT JOIN LATERAL (
        SELECT nome,usuario FROM administradores WHERE empresa_id=e.id ORDER BY created_at LIMIT 1
      ) a ON TRUE
      ORDER BY e.criado_em DESC
    `);
    res.json(r.rows);
  } catch(e){res.status(500).json({erro:e.message});}
}
async function obterEmpresa(req,res){try{const r=await pool.query('SELECT * FROM empresas WHERE id=$1',[req.params.id]);if(!r.rows[0])return res.status(404).json({erro:'Empresa não encontrada'});res.json(r.rows[0]);}catch(e){res.status(500).json({erro:e.message});}}
async function obterEmpresaPublica(req,res){try{const r=await pool.query(`SELECT id,nome,logo,plano,status,vencimento,galeria_ativa FROM empresas WHERE id=$1`,[req.params.id]);const e=r.rows[0];if(!e||e.status!=='ativo'||(e.vencimento&&new Date(e.vencimento)<new Date(new Date().toISOString().slice(0,10))))return res.status(403).json({erro:'Sistema indisponível.'});res.json(e);}catch(e){res.status(500).json({erro:e.message});}}
async function obterMinhaEmpresa(req,res){req.params.id=req.usuario.empresa_id;return obterEmpresa(req,res);}

async function atualizarEmpresa(req,res){try{const {nome,telefone,email,logo,whatsapp_notificacoes,plano,backup_frequencia,status,vencimento,limite_equipe}=req.body;if(plano&& !planoValido(plano))return res.status(400).json({erro:'Plano inválido.'});const r=await pool.query(`UPDATE empresas SET nome=COALESCE($1,nome),telefone=COALESCE($2,telefone),email=COALESCE($3,email),logo=COALESCE($4,logo),whatsapp_notificacoes=COALESCE($5,whatsapp_notificacoes),plano=COALESCE($6,plano),backup_frequencia=COALESCE($7,backup_frequencia),status=COALESCE($8,status),vencimento=COALESCE($9,vencimento),limite_equipe=CASE WHEN COALESCE($6,plano)='combo' THEN COALESCE($10,limite_equipe,1) ELSE 0 END,atualizado_em=NOW() WHERE id=$11 RETURNING *`,[nome??null,telefone??null,email??null,logo??null,whatsapp_notificacoes??null,plano??null,backup_frequencia??null,status??null,vencimento??null,limite_equipe??null,req.params.id]);if(!r.rows[0])return res.status(404).json({erro:'Empresa não encontrada'});res.json(r.rows[0]);}catch(e){res.status(500).json({erro:e.message});}}
async function atualizarMinhaEmpresa(req,res){req.params.id=req.usuario.empresa_id;delete req.body.plano;delete req.body.status;delete req.body.vencimento;return atualizarEmpresa(req,res);}

async function redefinirSenhaAdministrador(req,res){
  try {
    const novaSenha=String(req.body.nova_senha||'');
    if(novaSenha.length<6) return res.status(400).json({erro:'A nova senha deve ter pelo menos 6 caracteres.'});
    const hash=await bcrypt.hash(novaSenha,12);
    const r=await pool.query(`UPDATE administradores SET senha=$1 WHERE empresa_id=$2 RETURNING id,usuario,nome`,[hash,req.params.id]);
    if(!r.rows[0]) return res.status(404).json({erro:'Administrador da barbearia não encontrado.'});
    res.json({mensagem:'Senha do administrador redefinida.',administrador:r.rows[0]});
  } catch(e){res.status(500).json({erro:e.message});}
}


async function testarWhatsApp(req,res){
  try {
    const r=await pool.query('SELECT nome,plano,whatsapp_notificacoes,telefone FROM empresas WHERE id=$1',[req.usuario.empresa_id]);
    const empresa=r.rows[0];
    if(!empresa) return res.status(404).json({erro:'Barbearia não encontrada.'});
    if(String(empresa.plano||'').toLowerCase()==='bronze') return res.status(403).json({erro:'Notificações por WhatsApp não estão disponíveis no plano Bronze.'});
    const destino=empresa.whatsapp_notificacoes||empresa.telefone;
    if(!destino) return res.status(400).json({erro:'Cadastre o número que receberá as notificações.'});
    const resultado=await enviarMensagemTexto({
      destino,
      texto:`✅ Teste do AgendaRápida — ${empresa.nome}\n\nAs notificações de novos agendamentos estão configuradas para este número.`
    });
    if(!resultado.enviado) return res.status(502).json({erro:resultado.motivo,detalhes:resultado.dados||null});
    res.json({mensagem:'Mensagem de teste enviada com sucesso.',resultado});
  } catch(e){res.status(500).json({erro:e.message});}
}

async function excluirEmpresa(req,res){try{const r=await pool.query('DELETE FROM empresas WHERE id=$1 RETURNING id',[req.params.id]);if(!r.rows[0])return res.status(404).json({erro:'Empresa não encontrada'});res.json({mensagem:'Barbearia excluída.'});}catch(e){res.status(500).json({erro:e.message});}}
module.exports={criarEmpresa,listarEmpresas,obterEmpresa,obterEmpresaPublica,obterMinhaEmpresa,atualizarEmpresa,atualizarMinhaEmpresa,redefinirSenhaAdministrador,testarWhatsApp,excluirEmpresa};
