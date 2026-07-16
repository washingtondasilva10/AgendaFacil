const pool = require('../database/connection');

const planosGaleria = ['prata', 'ouro', 'combo'];
const LIMITE_FOTOS = 12;
const TAMANHO_MAXIMO_TEXTO = 3_000_000;

async function plano(empresa) {
  const r = await pool.query("SELECT plano FROM empresas WHERE id=$1 AND status='ativo'", [empresa]);
  return r.rows[0]?.plano;
}

async function barbeiroContexto(req){ if(req.usuario?.tipo==='barbeiro') return req.usuario.id; const r=await pool.query('SELECT barbeiro_principal_id FROM empresas WHERE id=$1',[req.usuario.empresa_id]); return r.rows[0]?.barbeiro_principal_id||null; }

function imagemValida(imagem) {
  return typeof imagem === 'string' &&
    imagem.length <= TAMANHO_MAXIMO_TEXTO &&
    /^data:image\/(jpeg|png|webp);base64,/i.test(imagem);
}

exports.publica = async (req, res) => {
  try {
    if (!planosGaleria.includes(String(await plano(req.params.empresa)).toLowerCase())) return res.json([]);
    const barbeiroId = req.query.barbeiro || null;
    const valores = barbeiroId
      ? [req.params.empresa, barbeiroId, LIMITE_FOTOS]
      : [req.params.empresa, LIMITE_FOTOS];
    const filtro = barbeiroId ? ' AND barbeiro_id=$2' : '';
    const limiteParam = barbeiroId ? '$3' : '$2';
    const r = await pool.query(
      `SELECT id,titulo,imagem FROM galeria_trabalhos
       WHERE empresa_id=$1 AND ativo=TRUE${filtro}
       ORDER BY criado_em DESC LIMIT ${limiteParam}`,
      valores
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
};

exports.listar = async (req, res) => {
  try {
    const barbeiroId=await barbeiroContexto(req);
    const filtro=' AND barbeiro_id=$2';
    const valores=[req.usuario.empresa_id,barbeiroId];
    const r = await pool.query(
      'SELECT * FROM galeria_trabalhos WHERE empresa_id=$1' + filtro + ' ORDER BY criado_em DESC',
      valores
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
};

exports.criar = async (req, res) => {
  try {
    if (!planosGaleria.includes(String(await plano(req.usuario.empresa_id)).toLowerCase())) {
      return res.status(403).json({ erro: 'Galeria disponível nos planos Prata, Ouro e Combo.' });
    }

    const { titulo, imagem } = req.body;
    if (!imagemValida(imagem)) {
      return res.status(400).json({ erro: 'Imagem inválida. Escolha uma foto JPG, PNG ou WEBP.' });
    }

    const barbeiroId = await barbeiroContexto(req);
    const contagem = await pool.query(
      `SELECT COUNT(*)::int AS total FROM galeria_trabalhos
       WHERE empresa_id=$1 AND ($2::uuid IS NULL OR barbeiro_id=$2)`,
      [req.usuario.empresa_id, barbeiroId]
    );
    if (contagem.rows[0].total >= LIMITE_FOTOS) {
      return res.status(400).json({ erro: `A galeria permite no máximo ${LIMITE_FOTOS} fotos.` });
    }

    const r = await pool.query(
      `INSERT INTO galeria_trabalhos(empresa_id,barbeiro_id,titulo,imagem)
       VALUES($1,$2,$3,$4) RETURNING *`,
      [req.usuario.empresa_id, barbeiroId, String(titulo || 'Trabalho').slice(0, 150), imagem]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
};

exports.remover = async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM galeria_trabalhos
       WHERE id=$1 AND empresa_id=$2 AND barbeiro_id=$3
       RETURNING id`,
      [req.params.id, req.usuario.empresa_id, await barbeiroContexto(req)]
    );
    if (!r.rows[0]) return res.status(404).json({ erro: 'Foto não encontrada.' });
    res.json({ mensagem: 'Foto removida.' });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
};
