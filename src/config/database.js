// config/database.js

const { Pool } = require('pg');
require('dotenv').config();

// ============================================
// CONFIGURAÇÃO DO POOL DE CONEXÕES
// ============================================
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  
  // Configurações do pool
  max: parseInt(process.env.DB_POOL_MAX) || 10,
  min: parseInt(process.env.DB_POOL_MIN) || 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  
  // SSL
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
};

// Criar pool de conexões
const pool = new Pool(dbConfig);

// ============================================
// CONFIGURAR SCHEMA PADRÃO
// ============================================
pool.on('connect', (client) => {
  const schema = process.env.DB_SCHEMA || 'zapvibe';
  client.query(`SET search_path TO ${schema}, public`);
});

// ============================================
// TRATAMENTO DE ERROS
// ============================================
pool.on('error', (err, client) => {
  console.error('❌ Erro inesperado no pool de conexões:', err);
  // Não encerrar o processo em desenvolvimento
  if (process.env.NODE_ENV === 'production') {
    process.exit(-1);
  }
});

// ============================================
// FUNÇÃO PARA TESTAR CONEXÃO
// ============================================
const testConnection = async () => {
  let client;
  try {
    client = await pool.connect();
    
    // Testar conexão básica
    const result = await client.query('SELECT NOW() as time, current_database() as database');
    console.log('✅ PostgreSQL conectado:', {
      database: result.rows[0].database,
      time: new Date(result.rows[0].time).toLocaleString('pt-BR')
    });
    
    // Verificar e configurar schema
    const schema = process.env.DB_SCHEMA || 'zapvibe';
    const schemaCheck = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name = $1
    `, [schema]);
    
    if (schemaCheck.rows.length > 0) {
      // Definir schema padrão
      await client.query(`SET search_path TO ${schema}`);
      console.log(`✅ Schema '${schema}' configurado`);
      
      // Contar tabelas
      const tablesCount = await client.query(`
        SELECT COUNT(*) as total
        FROM information_schema.tables 
        WHERE table_schema = $1 
        AND table_type = 'BASE TABLE'
      `, [schema]);
      
      console.log(`📊 Tabelas no schema: ${tablesCount.rows[0].total}`);
      
      // Verificar tabelas principais
      const mainTables = ['empresas', 'usuarios', 'contatos', 'conversas'];
      const tableChecks = await Promise.all(
        mainTables.map(table => 
          client.query(`
            SELECT EXISTS (
              SELECT FROM information_schema.tables 
              WHERE table_schema = $1 
              AND table_name = $2
            )
          `, [schema, table])
        )
      );
      
      const missingTables = mainTables.filter((table, index) => 
        !tableChecks[index].rows[0].exists
      );
      
      if (missingTables.length > 0) {
        console.warn(`⚠️ Tabelas faltando: ${missingTables.join(', ')}`);
        console.log('💡 Execute o script SQL para criar as tabelas');
      } else {
        console.log('✅ Todas as tabelas principais encontradas');
      }
      
    } else {
      console.error(`❌ Schema '${schema}' não encontrado!`);
      console.log('💡 Crie o schema com: CREATE SCHEMA IF NOT EXISTS ' + schema);
      throw new Error(`Schema ${schema} não existe`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Erro ao conectar com PostgreSQL:', error.message);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};

// ============================================
// FUNÇÕES AUXILIARES PARA QUERIES
// ============================================

/**
 * Executar query simples
 */
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    
    // Log em desenvolvimento
    if (process.env.DEBUG === 'true' && process.env.NODE_ENV === 'development') {
      console.log('Query executada:', {
        text: text.substring(0, 100),
        duration: `${duration}ms`,
        rows: res.rowCount
      });
    }
    
    return res;
  } catch (error) {
    console.error('Erro na query:', {
      error: error.message,
      query: text.substring(0, 100)
    });
    throw error;
  }
};

/**
 * Executar query com transação
 */
const transaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Transação revertida:', error.message);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Obter client para queries complexas
 */
const getClient = () => pool.connect();

/**
 * Query única que retorna um registro
 */
const findOne = async (text, params) => {
  const result = await query(text, params);
  return result.rows[0] || null;
};

/**
 * Query que retorna múltiplos registros
 */
const findMany = async (text, params) => {
  const result = await query(text, params);
  return result.rows;
};

/**
 * Insert que retorna o registro criado
 */
const insert = async (table, data) => {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`);
  
  const text = `
    INSERT INTO ${table} (${keys.join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING *
  `;
  
  const result = await query(text, values);
  return result.rows[0];
};

/**
 * Update que retorna o registro atualizado
 */
const update = async (table, id, data) => {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');
  
  const text = `
    UPDATE ${table}
    SET ${setClause}
    WHERE id = $1
    RETURNING *
  `;
  
  const result = await query(text, [id, ...values]);
  return result.rows[0];
};

/**
 * Delete que retorna true/false
 */
const remove = async (table, id) => {
  const text = `DELETE FROM ${table} WHERE id = $1`;
  const result = await query(text, [id]);
  return result.rowCount > 0;
};

// ============================================
// EXPORTAR MÓDULO
// ============================================
module.exports = {
  pool,
  query,
  transaction,
  getClient,
  testConnection,
  findOne,
  findMany,
  insert,
  update,
  remove
};