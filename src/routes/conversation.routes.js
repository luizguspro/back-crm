const express = require('express');
const router = express.Router();
const conversationController = require('../controllers/conversation.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.use(authMiddleware);

router.get('/', conversationController.getAll);
router.get('/:id/messages', conversationController.getMessages);
router.post('/:id/messages', conversationController.sendMessage);
router.put('/:id/read', conversationController.markAsRead);
router.put('/:id/status', conversationController.updateStatus);

module.exports = router;