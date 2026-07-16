const express = require('express');
const router = express.Router();
const controller = require('../controllers/servicos.controller');
const { verificarToken, exigirEmpresa } = require('../middlewares/auth');
router.get('/:empresa', controller.listar);
router.post('/', verificarToken, exigirEmpresa, controller.cadastrar);
router.put('/:id', verificarToken, controller.atualizar);
router.delete('/:id', verificarToken, controller.remover);
module.exports = router;
