const express = require('express');
const router = express.Router();
const controller = require('../controllers/administradores.controller');
const { verificarToken, exigirEmpresa, exigirAdministrador } = require('../middlewares/auth');
router.use(verificarToken, exigirAdministrador);
router.post('/', exigirEmpresa, controller.cadastrar);
router.get('/:empresa', exigirEmpresa, controller.listar);
module.exports = router;
