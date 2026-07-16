const express = require('express');
const router = express.Router();
const controller = require('../controllers/master.controller');
const { verificarToken, exigirMaster } = require('../middlewares/auth');
router.post('/login', controller.login);
router.get('/perfil', verificarToken, exigirMaster, controller.perfil);
router.put('/senha', verificarToken, exigirMaster, controller.alterarSenha);
module.exports = router;
