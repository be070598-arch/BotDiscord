const util = require('util');

module.exports = (db) => {
    // Promisifica o db.get e db.all para uso com async/await
    db.get = util.promisify(db.get);
    db.all = util.promisify(db.all);

    // --- QUERY UTILITÁRIA PARA RODAR INSERTS/UPDATES (db.run) ---
    const promisifiedRun = (sql, params = []) => {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function (err) {
                if (err) return reject(err);
                resolve(this); // Retorna 'this' para acessar this.lastID ou this.changes
            });
        });
    };

    // ***************************************************************
    // FUNÇÕES FALTANDO (CRÍTICAS PARA O INDEX.JS)
    // ***************************************************************

    // 1. FUNÇÃO CONNECT (Necessária para client.queries.connect no index.js)
    // O banco já está aberto, então esta função apenas resolve (simula a conexão)
    async function connect() {
        return Promise.resolve(true); 
    }
    
    // 2. FUNÇÃO CREATE TABLES (Necessária para client.queries.createTables no index.js)
    // Se esta lógica estiver em dbSetup.js, essa função aqui DEVE ser um placeholder vazio
    async function createTables() {
        // Se a lógica de criação de tabelas está em dbSetup, deixe esta função vazia.
        // Se a lógica estiver aqui, insira-a usando promisifiedRun().
        // Presumindo que a lógica está em dbSetup, ou que não houve erros anteriores.
        return Promise.resolve(true); 
    }

    // ***************************************************************
    // --- 1. FUNÇÕES DE CONFIGURAÇÃO (ITENS E CARGOS) ---

    // Busca uma configuração do DB (Ex: ITENS_FARM, CARGOS_GERENCIAIS)
    async function getConfig(key) {
        try {
            // CORREÇÃO: Tabela deve ser 'configurations' (no singular) ou 'configuracoes'
            // Mantendo 'configurations' conforme seu código, se estiver correto.
            const row = await db.get(`SELECT value FROM configurations WHERE key = ?`, [key]);
            if (!row) return null;
            return JSON.parse(row.value);
        } catch (error) {
            console.error(`❌ Erro ao buscar configuração ${key}:`, error.message);
            return null;
        }
    }

    // Salva uma configuração no DB
    async function setConfig(key, value) {
        try {
            const serializedValue = JSON.stringify(value);
            const result = await promisifiedRun(
                `INSERT INTO configurations (key, value) VALUES (?, ?) 
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
                [key, serializedValue]
            );
            return result.changes > 0;
        } catch (error) {
            console.error(`❌ Erro ao salvar configuração ${key}:`, error.message);
            return false;
        }
    }
    
    // FUNÇÃO ALIAS PARA O INDEX.JS: O index.js estava esperando 'insertConfig'
    // Como sua lógica é de INSERT OR UPDATE, usamos setConfig:
    const insertConfig = setConfig;


    // --- 2. FUNÇÕES DE USUÁRIO/ESTOQUE ---

    // Cria/Atualiza o registro do usuário/dono do painel
    async function registrarDono(discordId, canalId) {
        try {
            const result = await promisifiedRun(
                `INSERT INTO users (discordId, canalId, estoqueFarm, estoqueProducao) 
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(discordId) DO UPDATE SET canalId = excluded.canalId`,
                [discordId, canalId, JSON.stringify({}), JSON.stringify({})]
            );
            return result.changes > 0;
        } catch (error) {
            console.error(`❌ Erro ao registrar dono ${discordId}:`, error.message);
            return false;
        }
    }

    // Busca o registro de um usuário (inclui estoques)
    async function getUsuario(discordId) {
        try {
            const row = await db.get(`SELECT * FROM users WHERE discordId = ?`, [discordId]);
            if (!row) return null;

            // Desserializa os campos JSON
            row.estoqueFarm = JSON.parse(row.estoqueFarm || '{}');
            row.estoqueProducao = JSON.parse(row.estoqueProducao || '{}');

            return row;
        } catch (error) {
            console.error(`❌ Erro ao buscar usuário ${discordId}:`, error.message);
            return null;
        }
    }
    
    // Busca todos os estoques FARM (para consulta geral)
    async function getAllFarmStocks() {
        try {
            const rows = await db.all(`SELECT estoqueFarm FROM users`);
            if (!rows) return [];

            return rows.map(row => JSON.parse(row.estoqueFarm || '{}'));
        } catch (error) {
            console.error(`❌ Erro ao buscar todos os estoques:`, error.message);
            return [];
        }
    }

    // Atualiza o estoque do usuário
    async function updateEstoque(discordId, novoEstoqueFarm, novoEstoqueProducao) {
        try {
            const serializedFarm = JSON.stringify(novoEstoqueFarm);
            const serializedProd = JSON.stringify(novoEstoqueProducao);

            const result = await promisifiedRun(
                `UPDATE users SET estoqueFarm = ?, estoqueProducao = ? WHERE discordId = ?`,
                [serializedFarm, serializedProd, discordId]
            );
            return result.changes > 0;
        } catch (error) {
            console.error(`❌ Erro ao atualizar estoque de ${discordId}:`, error.message);
            return false;
        }
    }

    // --- 3. FUNÇÕES DE TRANSAÇÃO (LOG) ---

    // Adiciona um novo registro de transação ao DB
    async function addTransacao(data) {
        const serializedDetails = JSON.stringify(data.detalhes);
        
        // CORREÇÃO: Adiciona 'timestamp' explicitamente ao INSERT
        const sql = `INSERT INTO transacoes (tipo, executorId, alvoId, detalhes, statusProva, urlProva, timestamp) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`;

        try {
            const result = await promisifiedRun(sql, [
                data.tipo, 
                data.executorId, 
                data.alvoId, 
                serializedDetails, 
                data.statusProva || 'NENHUMA', // Garante que não é null
                data.urlProva
            ]);
            
            return result.lastID; 
        } catch (error) {
            console.error("❌ Erro ao adicionar transação:", error);
            return null; 
        }
    }

    // Atualiza o status de prova de uma transação
    async function updateTransacaoStatus(transacaoId, status, urlProva) {
        try {
            const result = await promisifiedRun(
                `UPDATE transacoes SET statusProva = ?, urlProva = ? WHERE transacaoId = ?`,
                [status, urlProva, transacaoId]
            );
            return result.changes > 0;
        } catch (error) {
            console.error(`❌ Erro ao atualizar status da transação ${transacaoId}:`, error.message);
            return false;
        }
    }
    
    // Busca as últimas N transações
    async function getTransacoes(alvoId, limit = 10) {
        try {
            let sql = `SELECT * FROM transacoes `;
            const params = [];

            if (alvoId) {
                sql += `WHERE alvoId = ? `;
                params.push(alvoId);
            }

            sql += `ORDER BY transacaoId DESC LIMIT ?`;
            params.push(limit);

            const rows = await db.all(sql, params);

            // Desserializa os detalhes
            return rows.map(row => ({
                ...row,
                detalhes: JSON.parse(row.detalhes || '{}')
            }));

        } catch (error) {
            console.error(`❌ Erro ao buscar transações:`, error.message);
            return [];
        }
    }


    // --- EXPORTAÇÃO DAS FUNÇÕES (INCLUINDO AS FUNÇÕES FALTANDO) ---
    return {
        // FUNÇÕES FALTANDO (AGORA INCLUÍDAS)
        connect, 
        createTables,
        
        // Configurações
        getConfig,
        setConfig,
        insertConfig, // Alias
        
        // Usuário/Estoque
        registrarDono,
        getUsuario,
        updateEstoque,
        getAllFarmStocks,
        
        // Transações
        addTransacao,
        updateTransacaoStatus,
        getTransacoes,
    };
};