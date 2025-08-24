const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class AuthController {
  async register(req, res) {
    const { nome, email, senha, telefone, empresa_nome } = req.body;
    
    try {
      // Verificar se email já existe
      const emailExists = await pool.query(
        'SELECT id FROM usuarios WHERE email = $1',
        [email]
      );
      
      if (emailExists.rows.length > 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'Email já cadastrado' 
        });
      }
      
      // Hash da senha
      const hashedPassword = await bcrypt.hash(senha, 10);
      
      // Criar empresa se fornecida
      let empresaId = null;
      if (empresa_nome) {
        const empresaResult = await pool.query(
          'INSERT INTO empresas (id, nome) VALUES ($1, $2) RETURNING id',
          [uuidv4(), empresa_nome]
        );
        empresaId = empresaResult.rows[0].id;
      }
      
      // Criar usuário
      const userId = uuidv4();
      const userResult = await pool.query(
        `INSERT INTO usuarios (id, nome, email, senha, telefone, empresa_id, tipo) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING id, nome, email, telefone, tipo`,
        [userId, nome, email, hashedPassword, telefone, empresaId, 'admin']
      );
      
      const user = userResult.rows[0];
      
      // Gerar token
      const token = jwt.sign(
        { id: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRE }
      );
      
      res.json({
        success: true,
        token,
        user
      });
      
    } catch (error) {
      console.error('Erro no registro:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erro ao criar conta' 
      });
    }
  }
  
  async login(req, res) {
    const { email, senha } = req.body;
    
    try {
      // Buscar usuário
      const result = await pool.query(
        'SELECT * FROM usuarios WHERE email = $1',
        [email]
      );
      
      if (result.rows.length === 0) {
        return res.status(401).json({ 
          success: false, 
          error: 'Email ou senha inválidos' 
        });
      }
      
      const user = result.rows[0];
      
      // Verificar senha
      const validPassword = await bcrypt.compare(senha, user.senha);
      
      if (!validPassword) {
        return res.status(401).json({ 
          success: false, 
          error: 'Email ou senha inválidos' 
        });
      }
      
      // Gerar token
      const token = jwt.sign(
        { id: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRE }
      );
      
      // Remover senha do objeto
      delete user.senha;
      
      res.json({
        success: true,
        token,
        user
      });
      
    } catch (error) {
      console.error('Erro no login:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erro ao fazer login' 
      });
    }
  }
  
  async me(req, res) {
    try {
      const result = await pool.query(
        'SELECT id, nome, email, telefone, tipo, empresa_id FROM usuarios WHERE id = $1',
        [req.userId]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'Usuário não encontrado' 
        });
      }
      
      res.json({
        success: true,
        user: result.rows[0]
      });
      
    } catch (error) {
      console.error('Erro ao buscar usuário:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erro ao buscar dados' 
      });
    }
  }
  
  async logout(req, res) {
    // Com JWT, logout é feito no cliente removendo o token
    res.json({ success: true, message: 'Logout realizado' });
  }
}

module.exports = new AuthController();