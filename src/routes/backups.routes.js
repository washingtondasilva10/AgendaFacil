const router = require('express').Router();
const controller = require('../controllers/backups.controller');
const { verificarToken, exigirAdministrador } = require('../middlewares/auth');
router.use(verificarToken, exigirAdministrador);
router.get('/', controller.listar);
router.post('/', controller.criar);
router.get('/:id/exportar', controller.exportar);
router.post('/:id/restaurar', controller.restaurar);
module.exports = router;
