const express = require('express');
const router = express.Router();
const controller = require('../controllers/horarios.controller');
const { verificarToken, exigirEmpresa } = require('../middlewares/auth');
router.get('/:empresa', controller.listarBloqueados);
router.post('/bloquear', verificarToken, exigirEmpresa, controller.bloquear);
router.delete('/:id', verificarToken, controller.desbloquear);
module.exports = router;
