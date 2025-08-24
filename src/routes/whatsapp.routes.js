const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsapp.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.use(authMiddleware);

router.post('/initialize', whatsappController.initialize);
router.get('/qr', whatsappController.getQR);
router.get('/status', whatsappController.getStatus);
router.post('/disconnect', whatsappController.disconnect);
router.post('/send', whatsappController.sendMessage);

// Bot config
router.get('/bot/config', whatsappController.getBotConfig);
router.post('/bot/config', whatsappController.saveBotConfig);

module.exports = router;