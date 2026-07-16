const pool = require('../database/connection');

async function listarBloqueados(req, res) {
  try {
    const { empresa } = req.params;
    const barbeiroId = req.query.barbeiro_id || null;
    const valores = [empresa];
    let sql = `SELECT * FROM horarios_bloqueados WHERE empresa_id=$1`;
    if (barbeiroId) { valores.push(barbeiroId); sql += ` AND barbeiro_id=$2`; }
    sql += ` ORDER BY data, hora`;
    const resultado = await pool.query(sql, valores);
    res.json(resultado.rows);
  } catch (erro) { res.status(500).json({ erro: erro.message }); }
}

async function bloquear(req, res) {
  try {
    const { empresa_id, barbeiro_id, data, hora, motivo } = req.body;
    if (!empresa_id || !barbeiro_id || !data || !hora) return res.status(400).json({ erro: 'Dados incompletos' });
    const existente = await pool.query(
      `SELECT * FROM horarios_bloqueados WHERE empresa_id=$1 AND barbeiro_id=$2 AND data=$3 AND hora=$4`,
      [empresa_id, barbeiro_id, data, hora]
    );
    if (existente.rows[0]) return res.status(200).json(existente.rows[0]);
    const resultado = await pool.query(
      `INSERT INTO horarios_bloqueados (empresa_id, barbeiro_id, data, hora, motivo)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [empresa_id, barbeiro_id, data, hora, motivo || 'Bloqueado pelo ADM']
    );
    res.status(201).json(resultado.rows[0]);
  } catch (erro) { res.status(500).json({ erro: erro.message }); }
}

async function desbloquear(req, res) {
  try {
    await pool.query('DELETE FROM horarios_bloqueados WHERE id=$1 AND empresa_id=$2', [req.params.id, req.usuario.empresa_id]);
    res.json({ mensagem: 'Horário desbloqueado' });
  } catch (erro) { res.status(500).json({ erro: erro.message }); }
}

module.exports = { listarBloqueados, bloquear, desbloquear };
