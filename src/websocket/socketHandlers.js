module.exports = (io) => {
  // Salvar io globalmente para uso em services
  global.io = io;
  
  io.on('connection', (socket) => {
    console.log('Nova conexão WebSocket:', socket.id);
    
    // Autenticar usuário
    socket.on('auth', (data) => {
      const { userId } = data;
      if (userId) {
        socket.join(`user-${userId}`);
        console.log(`Usuário ${userId} conectado`);
      }
    });
    
    // Entrar em sala da empresa
    socket.on('join-company', (empresaId) => {
      socket.join(`company-${empresaId}`);
    });
    
    // Enviar mensagem
    socket.on('send-message', async (data) => {
      const { conversationId, message, userId } = data;
      
      // Emitir para todos na conversa
      io.to(`conversation-${conversationId}`).emit('new-message', {
        conversationId,
        message
      });
    });
    
    // Typing indicator
    socket.on('typing', (data) => {
      socket.to(`conversation-${data.conversationId}`).emit('user-typing', data);
    });
    
    socket.on('disconnect', () => {
      console.log('Desconectado:', socket.id);
    });
  });
};