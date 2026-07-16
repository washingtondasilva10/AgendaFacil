const express = require('express');
const router = express.Router();
const controller = require('../controllers/auth.controller');
const { verificarToken } = require('../middlewares/auth');
router.post('/login', controller.login);
router.get('/perfil', verificarToken, controller.perfil);
router.put('/senha', verificarToken, controller.alterarSenha);
module.exports = router;
