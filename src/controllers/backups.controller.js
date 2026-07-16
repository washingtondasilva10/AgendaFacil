const pool = require('../database/connection');
const { criarBackup, restaurarBackup } = require('../services/backup.service');

exports.listar = async (req,res) => {
  try {
    const r = await pool.query('SELECT id, origem, criado_em FROM backups_empresa WHERE empresa_id=$1 ORDER BY criado_em DESC LIMIT 30', [req.usuario.empresa_id]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({erro:'Não foi possível listar os backups.', detalhe:e.message}); }
};

exports.criar = async (req,res) => {
  try {
    const backup = await criarBackup(req.usuario.empresa_id, 'manual');
    res.status(201).json({id:backup.id, origem:backup.origem, criado_em:backup.criado_em});
  } catch (e) { res.status(500).json({erro:'Não foi possível criar o backup.', detalhe:e.message}); }
};

exports.exportar = async (req,res) => {
  try {
    const r = await pool.query('SELECT dados, criado_em FROM backups_empresa WHERE id=$1 AND empresa_id=$2', [req.params.id, req.usuario.empresa_id]);
    if (!r.rows[0]) return res.status(404).json({erro:'Backup não encontrado.'});
    res.setHeader('Content-Disposition', `attachment; filename="AgendaRapida-backup-${req.params.id}.json"`);
    res.json({versao:'5.1-final', criado_em:r.rows[0].criado_em, dados:r.rows[0].dados});
  } catch (e) { res.status(500).json({erro:'Não foi possível exportar o backup.', detalhe:e.message}); }
};

exports.restaurar = async (req,res) => {
  try {
    await criarBackup(req.usuario.empresa_id, 'antes_restauracao');
    await restaurarBackup(req.usuario.empresa_id, req.params.id);
    res.json({mensagem:'Backup restaurado com sucesso.'});
  } catch (e) { res.status(500).json({erro:'Não foi possível restaurar o backup.', detalhe:e.message}); }
};
