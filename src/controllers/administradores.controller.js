const pool = require("../database/connection");
const bcrypt = require("bcryptjs");

async function cadastrar(req, res) {
  try {
    const { empresa_id, nome, email, usuario, senha } = req.body;

    if (!empresa_id || !nome || !(email || usuario) || !senha) {
      return res.status(400).json({ erro: "Preencha todos os campos" });
    }

    const senhaCriptografada = await bcrypt.hash(senha, 10);

    const resultado = await pool.query(
      `INSERT INTO administradores
       (empresa_id, nome, email, usuario, senha)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, empresa_id, nome, email, usuario, created_at`,
      [empresa_id, nome, email || null, usuario || null, senhaCriptografada]
    );

    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    res.status(500).json({
      erro: "Erro ao cadastrar administrador",
      detalhe: erro.message,
    });
  }
}

async function listar(req, res) {
  try {
    const { empresa } = req.params;

    const resultado = await pool.query(
      `SELECT id, empresa_id, nome, email, usuario, created_at
       FROM administradores
       WHERE empresa_id = $1
       ORDER BY created_at DESC`,
      [empresa]
    );

    res.json(resultado.rows);
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
}

module.exports = {
  cadastrar,
  listar,
};