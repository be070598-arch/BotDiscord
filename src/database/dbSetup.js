const sqlite3 = require('sqlite3');
const path = require('path');

// --- CONFIGURAÇÃO DE ITENS CORRIGIDA ---
const ITENS_FARM_CONFIG = [
    { idInterno: 'farinha_de_trigo', nome: 'Farinha de Trigo', multiplo: 1, min: null, max: null },
    { idInterno: 'cascas_de_semente', nome: 'Cascas de Semente', multiplo: 1, min: null, max: null },
    { idInterno: 'folhas', nome: 'Folhas', multiplo: 1, min: null, max: null },
    { idInterno: 'embalagens_plasticas', nome: 'Embalagens Plásticas', multiplo: 1, min: null, max: null },
    // Regra específica para o dinheiro limpo (múltiplo de 4500, mínimo 4500)
    { idInterno: 'dinheiro_limpo', nome: 'Dinheiro Limpo', multiplo: 4500, min: 4500, max: null }, 
];

const ITENS_PRODUCAO_CONFIG = [
    { idInterno: 'farinha', nome: 'Farinha', multiplo: 1, min: null, max: null },
];

const CARGOS_GERENCIAIS_CONFIG = {
    nome: 'Cargos Gerenciais',
    ids: [] // IDs dos cargos que podem usar funções gerenciais (Ajuste, Consulta Geral)
};
// ----------------------------------------

/**
 * Inicializa o banco de dados SQLite, cria as tabelas se necessário
 * e insere as configurações iniciais.
 * @returns {sqlite3.Database} O objeto de conexão com o banco de dados.
 */
function initializeDatabase() {
    const dbPath = path.join(__dirname, '..', '..', 'database.sqlite');
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
        if (err) {
            console.error(`❌ Erro ao abrir o banco de dados: ${err.message}`);
            return;
        }
        console.log('✅ Conectado ao banco de dados SQLite: database.sqlite');
        setupTables(db);
    });
    return db;
}

/**
 * Cria as tabelas e insere as configurações iniciais se for a primeira execução.
 * @param {sqlite3.Database} db O objeto de conexão com o banco de dados.
 */
function setupTables(db) {
    db.serialize(() => {
        // Tabela 1: Usuários e Estoques
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                discordId TEXT PRIMARY KEY,
                canalId TEXT NOT NULL,
                estoqueFarm TEXT,
                estoqueProducao TEXT
            )
        `);

        // Tabela 2: Logs de Transações
        db.run(`
            CREATE TABLE IF NOT EXISTS transacoes (
                transacaoId INTEGER PRIMARY KEY AUTOINCREMENT,
                tipo TEXT NOT NULL,
                executorId TEXT NOT NULL,
                alvoId TEXT NOT NULL,
                detalhes TEXT NOT NULL,
                statusProva TEXT,
                urlProva TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Tabela 3: Configurações Globais (Itens, Cargos, etc.)
        db.run(`
            CREATE TABLE IF NOT EXISTS configurations (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        `, () => {
             insertInitialConfig(db);
        });
    });
}

function insertInitialConfig(db) {
    // Função para inserção/atualização das configurações
    const insertConfig = (key, value) => {
        const serializedValue = JSON.stringify(value);
        db.run(
            `INSERT INTO configurations (key, value) VALUES (?, ?) 
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            [key, serializedValue],
            (err) => {
                if (err) {
                    console.error(`❌ Erro ao inserir configuração ${key}:`, err.message);
                }
            }
        );
    };

    // Insere/Atualiza as configurações iniciais
    insertConfig('ITENS_FARM', ITENS_FARM_CONFIG);
    insertConfig('ITENS_PRODUCAO', ITENS_PRODUCAO_CONFIG);
    insertConfig('CARGOS_GERENCIAIS', CARGOS_GERENCIAIS_CONFIG);

    console.log('✅ Tabelas verificadas e configurações iniciais inseridas.');
}

module.exports = initializeDatabase;