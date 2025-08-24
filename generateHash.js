const bcrypt = require('bcryptjs');

const senha = 'admin123';
const hash = bcrypt.hashSync(senha, 10);

console.log('Hash gerado para admin123:');
console.log(hash);
console.log('\nSQL para atualizar:');
console.log(`UPDATE usuarios SET senha = '${hash}' WHERE email = 'admin@zapvibe.com';`);