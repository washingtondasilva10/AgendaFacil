const pool = require('../database/connection');

const TABELAS = ['configuracoes_empresa','barbeiros','servicos','agendamentos','horarios_bloqueados','galeria_trabalhos','produtos','agendamento_produtos','vendas_loja','venda_itens'];

async function coletarDadosEmpresa(client, empresaId) {
  const dados = {};
  const empresa = await client.query('SELECT * FROM empresas WHERE id=$1', [empresaId]);
  dados.empresa = empresa.rows[0] || null;
  for (const tabela of TABELAS) {
    const resultado = await client.query(`SELECT * FROM ${tabela} WHERE empresa_id=$1 ORDER BY 1`, [empresaId]);
    dados[tabela] = resultado.rows;
  }
  return dados;
}

async function criarBackup(empresaId, origem='manual') {
  const client = await pool.connect();
  try {
    const dados = await coletarDadosEmpresa(client, empresaId);
    if (!dados.empresa) throw new Error('Barbearia não encontrada.');
    const resultado = await client.query(
      `INSERT INTO backups_empresa (empresa_id, origem, dados) VALUES ($1,$2,$3::jsonb) RETURNING id, origem, criado_em`,
      [empresaId, origem, JSON.stringify(dados)]
    );
    return { ...resultado.rows[0], dados };
  } finally { client.release(); }
}

async function criarBackupsAutomaticos() {
  const empresas = await pool.query(`SELECT id,backup_frequencia,ultimo_backup_em FROM empresas WHERE status='ativo' AND (ultimo_backup_em IS NULL OR (backup_frequencia='diario' AND ultimo_backup_em < NOW()-INTERVAL '1 day') OR (backup_frequencia='semanal' AND ultimo_backup_em < NOW()-INTERVAL '7 days') OR (backup_frequencia='mensal' AND ultimo_backup_em < NOW()-INTERVAL '1 month'))`);
  for (const empresa of empresas.rows) {
    try { await criarBackup(empresa.id, 'automatico'); await pool.query('UPDATE empresas SET ultimo_backup_em=NOW() WHERE id=$1',[empresa.id]); }
    catch (erro) { console.error(`Backup automático falhou para ${empresa.id}:`, erro.message); }
  }
  await pool.query("DELETE FROM backups_empresa WHERE origem='automatico' AND criado_em < NOW() - INTERVAL '30 days'");
}

async function restaurarBackup(empresaId, backupId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const consulta = await client.query('SELECT dados FROM backups_empresa WHERE id=$1 AND empresa_id=$2', [backupId, empresaId]);
    if (!consulta.rows[0]) throw new Error('Backup não encontrado.');
    const dados = consulta.rows[0].dados;

    await client.query('DELETE FROM venda_itens WHERE venda_id IN (SELECT id FROM vendas_loja WHERE empresa_id=$1)', [empresaId]);
    await client.query('DELETE FROM vendas_loja WHERE empresa_id=$1', [empresaId]);
    await client.query('DELETE FROM agendamento_produtos WHERE empresa_id=$1', [empresaId]);
    await client.query('DELETE FROM produtos WHERE empresa_id=$1', [empresaId]);
    await client.query('DELETE FROM galeria_trabalhos WHERE empresa_id=$1', [empresaId]);
    await client.query('DELETE FROM horarios_bloqueados WHERE empresa_id=$1', [empresaId]);
    await client.query('DELETE FROM agendamentos WHERE empresa_id=$1', [empresaId]);
    await client.query('DELETE FROM servicos WHERE empresa_id=$1', [empresaId]);
    await client.query('DELETE FROM barbeiros WHERE empresa_id=$1', [empresaId]);
    await client.query('DELETE FROM configuracoes_empresa WHERE empresa_id=$1', [empresaId]);

    const inserir = async (tabela, linhas) => {
      for (const linha of linhas || []) {
        const colunas = Object.keys(linha);
        const valores = Object.values(linha);
        const marcadores = valores.map((_, i) => `$${i+1}`).join(',');
        await client.query(`INSERT INTO ${tabela} (${colunas.join(',')}) VALUES (${marcadores})`, valores);
      }
    };

    await inserir('configuracoes_empresa', dados.configuracoes_empresa);
    await inserir('barbeiros', dados.barbeiros);
    await inserir('servicos', dados.servicos);
    await inserir('agendamentos', dados.agendamentos);
    await inserir('horarios_bloqueados', dados.horarios_bloqueados);
    await inserir('galeria_trabalhos', dados.galeria_trabalhos);
    await inserir('produtos', dados.produtos);
    await inserir('agendamento_produtos', dados.agendamento_produtos);
    await inserir('vendas_loja', dados.vendas_loja);
    await inserir('venda_itens', dados.venda_itens);
    await client.query('COMMIT');
    return true;
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally { client.release(); }
}

module.exports = { criarBackup, criarBackupsAutomaticos, restaurarBackup };
