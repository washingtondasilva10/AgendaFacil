const pool = require('./connection');
const bcrypt = require('bcryptjs');

async function migrate() {
  const comandos = [
    `CREATE EXTENSION IF NOT EXISTS pgcrypto`,

    `CREATE TABLE IF NOT EXISTS usuarios_master (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nome VARCHAR(150) NOT NULL DEFAULT 'Administrador Master',
      usuario VARCHAR(100) NOT NULL UNIQUE,
      senha VARCHAR(255) NOT NULL,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS empresas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nome VARCHAR(150) NOT NULL,
      telefone VARCHAR(30),
      whatsapp_notificacoes VARCHAR(30),
      logo TEXT,
      plano VARCHAR(20) NOT NULL DEFAULT 'bronze',
      status VARCHAR(20) NOT NULL DEFAULT 'ativo',
      vencimento DATE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS administradores (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      nome VARCHAR(150) NOT NULL,
      email VARCHAR(180),
      usuario VARCHAR(100),
      senha VARCHAR(255) NOT NULL,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (empresa_id, email),
      UNIQUE (usuario)
    )`,

    `CREATE TABLE IF NOT EXISTS barbeiros (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      nome VARCHAR(150) NOT NULL,
      usuario VARCHAR(100),
      senha VARCHAR(255),
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (empresa_id, usuario)
    )`,

    `CREATE TABLE IF NOT EXISTS servicos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      nome VARCHAR(150) NOT NULL,
      preco NUMERIC(10,2) NOT NULL CHECK (preco >= 0),
      duracao INTEGER NOT NULL CHECK (duracao > 0),
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS agendamentos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      barbeiro_id UUID NOT NULL REFERENCES barbeiros(id) ON DELETE RESTRICT,
      servico_id UUID NOT NULL REFERENCES servicos(id) ON DELETE RESTRICT,
      cliente VARCHAR(150) NOT NULL,
      whatsapp VARCHAR(30) NOT NULL,
      data DATE NOT NULL,
      hora TIME NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'agendado',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (status IN ('agendado','concluido','nao_compareceu','cancelado'))
    )`,

    `CREATE TABLE IF NOT EXISTS horarios_bloqueados (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      barbeiro_id UUID NOT NULL REFERENCES barbeiros(id) ON DELETE CASCADE,
      data DATE NOT NULL,
      hora TIME NOT NULL,
      motivo VARCHAR(200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (empresa_id, barbeiro_id, data, hora)
    )`,

    `CREATE TABLE IF NOT EXISTS auditoria (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
      usuario_id UUID,
      usuario_tipo VARCHAR(30),
      acao VARCHAR(120) NOT NULL,
      detalhes JSONB,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS backups_empresa (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      origem VARCHAR(30) NOT NULL DEFAULT 'manual',
      dados JSONB NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS configuracoes_empresa (
      empresa_id UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
      horario_abertura TIME NOT NULL DEFAULT '08:00',
      horario_fechamento TIME NOT NULL DEFAULT '21:00',
      intervalo_minutos INTEGER NOT NULL DEFAULT 30 CHECK (intervalo_minutos > 0),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `ALTER TABLE empresas ADD COLUMN IF NOT EXISTS email VARCHAR(180)`,
    `ALTER TABLE empresas ADD COLUMN IF NOT EXISTS logo TEXT`,
    `ALTER TABLE empresas ADD COLUMN IF NOT EXISTS whatsapp_notificacoes VARCHAR(30)`,
    `ALTER TABLE empresas ADD COLUMN IF NOT EXISTS plano VARCHAR(20) DEFAULT 'bronze'`,
    `ALTER TABLE empresas ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ativo'`,
    `ALTER TABLE empresas ADD COLUMN IF NOT EXISTS vencimento DATE`,

    `ALTER TABLE administradores ADD COLUMN IF NOT EXISTS usuario VARCHAR(100)`,
    `ALTER TABLE administradores ALTER COLUMN email DROP NOT NULL`,

    `ALTER TABLE barbeiros ADD COLUMN IF NOT EXISTS usuario VARCHAR(100)`,
    `ALTER TABLE barbeiros ADD COLUMN IF NOT EXISTS senha VARCHAR(255)`,
    `ALTER TABLE barbeiros ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT TRUE`,
    `ALTER TABLE barbeiros ADD COLUMN IF NOT EXISTS whatsapp_notificacoes VARCHAR(30)`,

    `ALTER TABLE servicos
     ADD COLUMN IF NOT EXISTS barbeiro_id UUID
     REFERENCES barbeiros(id)
     ON DELETE CASCADE`,

    `ALTER TABLE empresas
     ADD COLUMN IF NOT EXISTS backup_frequencia VARCHAR(20)
     NOT NULL DEFAULT 'diario'`,

    `ALTER TABLE empresas
     ADD COLUMN IF NOT EXISTS ultimo_backup_em TIMESTAMPTZ`,

    `ALTER TABLE empresas
     ADD COLUMN IF NOT EXISTS galeria_ativa BOOLEAN
     NOT NULL DEFAULT TRUE`,

    `ALTER TABLE empresas
     ADD COLUMN IF NOT EXISTS limite_equipe INTEGER
     NOT NULL DEFAULT 0`,

    `ALTER TABLE empresas
     ADD COLUMN IF NOT EXISTS barbeiro_principal_id UUID`,

    `ALTER TABLE empresas
     DROP CONSTRAINT IF EXISTS empresas_limite_equipe_check`,

    `ALTER TABLE empresas
     ADD CONSTRAINT empresas_limite_equipe_check
     CHECK (limite_equipe >= 0 AND limite_equipe <= 50)`,

    `CREATE TABLE IF NOT EXISTS galeria_trabalhos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      barbeiro_id UUID REFERENCES barbeiros(id) ON DELETE CASCADE,
      titulo VARCHAR(150),
      imagem TEXT NOT NULL,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS produtos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      barbeiro_id UUID REFERENCES barbeiros(id) ON DELETE CASCADE,
      nome VARCHAR(150) NOT NULL,
      descricao TEXT,
      categoria VARCHAR(80),
      imagem TEXT,
      preco NUMERIC(10,2) NOT NULL CHECK (preco >= 0),
      estoque INTEGER NOT NULL DEFAULT 0 CHECK (estoque >= 0),
      estoque_minimo INTEGER NOT NULL DEFAULT 0 CHECK (estoque_minimo >= 0),
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS agendamento_produtos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      agendamento_id UUID NOT NULL REFERENCES agendamentos(id) ON DELETE CASCADE,
      produto_id UUID NOT NULL REFERENCES produtos(id) ON DELETE RESTRICT,
      quantidade INTEGER NOT NULL CHECK (quantidade > 0),
      preco_unitario NUMERIC(10,2) NOT NULL CHECK (preco_unitario >= 0),
      status VARCHAR(30) NOT NULL DEFAULT 'reservado',
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (status IN ('reservado','concluido','cancelado','nao_levou'))
    )`,

    `CREATE TABLE IF NOT EXISTS vendas_loja (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      barbeiro_id UUID REFERENCES barbeiros(id) ON DELETE SET NULL,
      agendamento_id UUID REFERENCES agendamentos(id) ON DELETE SET NULL,
      total NUMERIC(10,2) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'concluida',
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS venda_itens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      venda_id UUID NOT NULL REFERENCES vendas_loja(id) ON DELETE CASCADE,
      produto_id UUID REFERENCES produtos(id) ON DELETE SET NULL,
      nome_produto VARCHAR(150) NOT NULL,
      quantidade INTEGER NOT NULL CHECK (quantidade > 0),
      preco_unitario NUMERIC(10,2) NOT NULL CHECK (preco_unitario >= 0)
    )`,

    `CREATE INDEX IF NOT EXISTS idx_galeria_empresa
     ON galeria_trabalhos (empresa_id, ativo)`,

    `CREATE INDEX IF NOT EXISTS idx_produtos_empresa
     ON produtos (empresa_id, ativo)`,

    `CREATE INDEX IF NOT EXISTS idx_agendamento_produtos_agendamento
     ON agendamento_produtos (agendamento_id)`,

    `CREATE INDEX IF NOT EXISTS idx_vendas_empresa_data
     ON vendas_loja (empresa_id, criado_em DESC)`,

    `CREATE UNIQUE INDEX IF NOT EXISTS idx_administradores_usuario_unico
     ON administradores (LOWER(usuario))
     WHERE usuario IS NOT NULL`,

    `CREATE INDEX IF NOT EXISTS idx_administradores_empresa
     ON administradores (empresa_id)`,

    `CREATE INDEX IF NOT EXISTS idx_barbeiros_empresa
     ON barbeiros (empresa_id)`,

    `UPDATE empresas e
     SET barbeiro_principal_id = (
       SELECT b.id
       FROM barbeiros b
       WHERE b.empresa_id = e.id
       ORDER BY b.created_at ASC
       LIMIT 1
     )
     WHERE e.barbeiro_principal_id IS NULL`,

    `UPDATE produtos p
     SET barbeiro_id = e.barbeiro_principal_id
     FROM empresas e
     WHERE p.empresa_id = e.id
       AND p.barbeiro_id IS NULL
       AND e.barbeiro_principal_id IS NOT NULL`,

    `UPDATE galeria_trabalhos g
     SET barbeiro_id = e.barbeiro_principal_id
     FROM empresas e
     WHERE g.empresa_id = e.id
       AND g.barbeiro_id IS NULL
       AND e.barbeiro_principal_id IS NOT NULL`,

    `INSERT INTO servicos (
       empresa_id,
       barbeiro_id,
       nome,
       preco,
       duracao,
       ativo
     )
     SELECT
       b.empresa_id,
       b.id,
       s.nome,
       s.preco,
       s.duracao,
       s.ativo
     FROM barbeiros b
     JOIN empresas e
       ON e.id = b.empresa_id
     JOIN servicos s
       ON s.empresa_id = b.empresa_id
      AND s.barbeiro_id = e.barbeiro_principal_id
     WHERE b.id <> e.barbeiro_principal_id
       AND NOT EXISTS (
         SELECT 1
         FROM servicos x
         WHERE x.empresa_id = b.empresa_id
           AND x.barbeiro_id = b.id
       )`,

    `UPDATE servicos s
     SET barbeiro_id = e.barbeiro_principal_id
     FROM empresas e
     WHERE s.empresa_id = e.id
       AND s.barbeiro_id IS NULL
       AND e.barbeiro_principal_id IS NOT NULL`,

    `INSERT INTO servicos (
       empresa_id,
       barbeiro_id,
       nome,
       preco,
       duracao,
       ativo
     )
     SELECT
       b.empresa_id,
       b.id,
       v.nome,
       v.preco,
       v.duracao,
       TRUE
     FROM barbeiros b
     JOIN empresas e
       ON e.id = b.empresa_id
      AND LOWER(e.plano) = 'combo'
     CROSS JOIN (
       VALUES
         ('Corte', 30::numeric, 40),
         ('Barba', 20::numeric, 20),
         ('Sobrancelha', 10::numeric, 10),
         ('Corte + Barba', 45::numeric, 60)
     ) AS v(nome, preco, duracao)
     WHERE NOT EXISTS (
       SELECT 1
       FROM servicos s
       WHERE s.empresa_id = b.empresa_id
         AND s.barbeiro_id = b.id
     )`,

    `CREATE INDEX IF NOT EXISTS idx_servicos_empresa
     ON servicos (empresa_id)`,

    `CREATE INDEX IF NOT EXISTS idx_servicos_empresa_barbeiro
     ON servicos (empresa_id, barbeiro_id)`,

    `CREATE INDEX IF NOT EXISTS idx_agendamentos_empresa_data
     ON agendamentos (empresa_id, data)`,

    `CREATE INDEX IF NOT EXISTS idx_agendamentos_empresa_barbeiro_data
     ON agendamentos (empresa_id, barbeiro_id, data)`,

    `CREATE INDEX IF NOT EXISTS idx_backups_empresa_data
     ON backups_empresa (empresa_id, criado_em DESC)`,

    `CREATE INDEX IF NOT EXISTS idx_bloqueios_empresa_barbeiro_data
     ON horarios_bloqueados (empresa_id, barbeiro_id, data)`,

    `UPDATE empresas
     SET plano = 'bronze'
     WHERE LOWER(plano) IN ('simples', 'unico')`,

    `UPDATE empresas
     SET plano = 'prata'
     WHERE LOWER(plano) IN ('medio', 'intermediario')`,

    `UPDATE empresas
     SET plano = 'combo'
     WHERE LOWER(plano) = 'premium'`,

    `UPDATE agendamentos
     SET status = 'agendado'
     WHERE status IN ('aguardando', 'confirmado', 'pendente')`,

    `UPDATE agendamentos
     SET status = 'concluido'
     WHERE status IN ('finalizado', 'atendido')`,

    `UPDATE agendamentos
     SET status = 'nao_compareceu'
     WHERE status IN ('nao_concluido', 'faltou')`
  ];

  const client = await pool.connect();
  let comandoAtual = '';

  try {
    await client.query('BEGIN');

    for (let indice = 0; indice < comandos.length; indice += 1) {
      comandoAtual = comandos[indice];

      try {
        await client.query(comandoAtual);
      } catch (erroSql) {
        console.error(`❌ Erro no comando SQL número ${indice + 1}:`);
        console.error(comandoAtual);
        console.error('❌ Detalhes do PostgreSQL:', erroSql);
        throw erroSql;
      }
    }

   const masterUser = String(process.env.MASTER_USER || '').trim();
const masterPassword = String(process.env.MASTER_PASSWORD || '');

if (!masterUser || masterPassword.length < 6) {
  throw new Error(
    'Configure MASTER_USER e MASTER_PASSWORD com no mínimo 6 caracteres nas variáveis do Railway.'
  );
}

const hash = await bcrypt.hash(masterPassword, 12);

await client.query(
  `INSERT INTO usuarios_master (usuario, senha, ativo)
   VALUES ($1, $2, TRUE)
   ON CONFLICT (usuario)
   DO UPDATE SET
     senha = EXCLUDED.senha,
     ativo = TRUE,
     atualizado_em = NOW()`,
  [masterUser, hash]
);

console.log(`✅ Usuário do Control Center atualizado: ${masterUser}`);

await client.query('COMMIT');

    console.log('✅ Banco Agenda Fácil V6 preparado com sucesso.');
  } catch (erro) {
    try {
      await client.query('ROLLBACK');
    } catch (erroRollback) {
      console.error('❌ Erro ao desfazer a migração:', erroRollback);
    }

    console.error('❌ ERRO COMPLETO DA MIGRAÇÃO:');
    console.error(erro);

    if (erro && erro.message) {
      console.error('❌ Mensagem:', erro.message);
    }

    if (erro && erro.code) {
      console.error('❌ Código PostgreSQL:', erro.code);
    }

    if (erro && erro.detail) {
      console.error('❌ Detalhes:', erro.detail);
    }

    if (erro && erro.hint) {
      console.error('❌ Sugestão:', erro.hint);
    }

    if (comandoAtual) {
      console.error('❌ Último comando executado:');
      console.error(comandoAtual);
    }

    throw erro;
  } finally {
    client.release();
  }
}

module.exports = migrate;