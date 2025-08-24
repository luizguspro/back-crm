const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs');
const path = require('path');

class ContactController {
  async getAll(req, res) {
    try {
      const { search, page = 1 } = req.query;
      const limit = 20;
      const offset = (page - 1) * limit;
      
      let query = 'SELECT * FROM contatos WHERE usuario_id = $1';
      let params = [req.userId];
      
      if (search) {
        query += ' AND (nome ILIKE $2 OR email ILIKE $2 OR empresa ILIKE $2)';
        params.push(`%${search}%`);
      }
      
      query += ' ORDER BY criado_em DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
      params.push(limit, offset);
      
      const result = await pool.query(query, params);
      
      const countResult = await pool.query(
        'SELECT COUNT(*) FROM contatos WHERE usuario_id = $1',
        [req.userId]
      );
      
      res.json({
        contatos: result.rows,
        total: parseInt(countResult.rows[0].count)
      });
      
    } catch (error) {
      console.error('Erro ao buscar contatos:', error);
      res.status(500).json({ error: 'Erro ao buscar contatos' });
    }
  }
  
  async create(req, res) {
    try {
      const { nome, email, telefone, whatsapp, empresa, cpf_cnpj, cargo } = req.body;
      
      const id = uuidv4();
      const result = await pool.query(
        `INSERT INTO contatos 
         (id, usuario_id, nome, email, telefone, whatsapp, empresa, cpf_cnpj, cargo, score, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [id, req.userId, nome, email, telefone, whatsapp, empresa, cpf_cnpj, cargo, 50, ['Novo']]
      );
      
      res.json(result.rows[0]);
      
    } catch (error) {
      console.error('Erro ao criar contato:', error);
      res.status(500).json({ error: 'Erro ao criar contato' });
    }
  }
  
  async update(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      const fields = Object.keys(updates);
      const values = Object.values(updates);
      
      const setClause = fields.map((field, i) => `${field} = $${i + 3}`).join(', ');
      
      const result = await pool.query(
        `UPDATE contatos SET ${setClause}, atualizado_em = NOW()
         WHERE id = $1 AND usuario_id = $2
         RETURNING *`,
        [id, req.userId, ...values]
      );
      
      res.json(result.rows[0]);
      
    } catch (error) {
      console.error('Erro ao atualizar contato:', error);
      res.status(500).json({ error: 'Erro ao atualizar contato' });
    }
  }
  
  async delete(req, res) {
    try {
      const { id } = req.params;
      
      await pool.query(
        'DELETE FROM contatos WHERE id = $1 AND usuario_id = $2',
        [id, req.userId]
      );
      
      res.json({ success: true });
      
    } catch (error) {
      console.error('Erro ao deletar contato:', error);
      res.status(500).json({ error: 'Erro ao deletar contato' });
    }
  }
  
  async importCSV(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado' });
      }
      
      const results = [];
      let criados = 0;
      let atualizados = 0;
      let erros = [];
      
      fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', async (data) => {
          try {
            // Processar cada linha
            const contato = {
              id: uuidv4(),
              usuario_id: req.userId,
              nome: data.Nome || data.nome,
              email: data.Email || data.email,
              telefone: data.Telefone || data.telefone,
              whatsapp: data.WhatsApp || data.whatsapp,
              empresa: data.Empresa || data.empresa,
              cargo: data.Cargo || data.cargo,
              cpf_cnpj: data['CPF/CNPJ'] || data.cpf_cnpj
            };
            
            // Verificar se já existe
            const exists = await pool.query(
              'SELECT id FROM contatos WHERE email = $1 AND usuario_id = $2',
              [contato.email, req.userId]
            );
            
            if (exists.rows.length > 0) {
              // Atualizar
              await pool.query(
                `UPDATE contatos SET nome = $1, telefone = $2, whatsapp = $3, empresa = $4
                 WHERE email = $5 AND usuario_id = $6`,
                [contato.nome, contato.telefone, contato.whatsapp, contato.empresa, contato.email, req.userId]
              );
              atualizados++;
            } else {
              // Criar
              await pool.query(
                `INSERT INTO contatos 
                 (id, usuario_id, nome, email, telefone, whatsapp, empresa, cargo, cpf_cnpj, score, tags)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [contato.id, contato.usuario_id, contato.nome, contato.email, 
                 contato.telefone, contato.whatsapp, contato.empresa, 
                 contato.cargo, contato.cpf_cnpj, 50, ['Importado']]
              );
              criados++;
            }
          } catch (err) {
            erros.push({ linha: data, erro: err.message });
          }
        })
        .on('end', () => {
          // Deletar arquivo temporário
          fs.unlinkSync(req.file.path);
          
          res.json({
            success: true,
            criados,
            atualizados,
            erros: erros.length,
            detalhesErros: erros
          });
        });
        
    } catch (error) {
      console.error('Erro ao importar CSV:', error);
      res.status(500).json({ error: 'Erro ao importar arquivo' });
    }
  }
  
  async export(req, res) {
    try {
      const result = await pool.query(
        'SELECT * FROM contatos WHERE usuario_id = $1',
        [req.userId]
      );
      
      const csvData = result.rows.map(contact => ({
        Nome: contact.nome,
        Email: contact.email,
        Telefone: contact.telefone,
        WhatsApp: contact.whatsapp,
        Empresa: contact.empresa,
        Cargo: contact.cargo,
        'CPF/CNPJ': contact.cpf_cnpj,
        Score: contact.score,
        Tags: contact.tags?.join(', ')
      }));
      
      const csvHeaders = [
        { id: 'Nome', title: 'Nome' },
        { id: 'Email', title: 'Email' },
        { id: 'Telefone', title: 'Telefone' },
        { id: 'WhatsApp', title: 'WhatsApp' },
        { id: 'Empresa', title: 'Empresa' },
        { id: 'Cargo', title: 'Cargo' },
        { id: 'CPF/CNPJ', title: 'CPF/CNPJ' },
        { id: 'Score', title: 'Score' },
        { id: 'Tags', title: 'Tags' }
      ];
      
      const csvStringifier = createCsvWriter.createObjectCsvStringifier({
        header: csvHeaders
      });
      
      const csvString = csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(csvData);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="contatos.csv"');
      res.send(csvString);
      
    } catch (error) {
      console.error('Erro ao exportar contatos:', error);
      res.status(500).json({ error: 'Erro ao exportar contatos' });
    }
  }
}

module.exports = new ContactController();