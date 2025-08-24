const express = require('express');
const router = express.Router();
const automationController = require('../controllers/automation.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.use(authMiddleware);

router.get('/status', automationController.getStatus);
router.post('/start', automationController.start);
router.post('/stop', automationController.stop);
router.get('/flows', automationController.getFlows);
router.put('/flows/:flowId', automationController.updateFlow);
router.post('/run-now', automationController.runNow);

module.exports = router;