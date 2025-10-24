// Carrega as variáveis de ambiente (DISCORD_TOKEN, GUILD_ID) do arquivo .env
require('dotenv').config();

const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const path = require('path');
const fs = require('fs');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

// Importações de DB (Corrigidas com path.join)
const initializeDatabase = require(path.join(__dirname, 'src', 'database', 'dbSetup'));
const dbQueries = require(path.join(__dirname, 'src', 'database', 'dbQueries')); 

// ----------------------------------------------------------------------
// --- INICIALIZAÇÃO SÍNCRONA E IMEDIATA DO BANCO DE DADOS ---
// ----------------------------------------------------------------------

// 1. Cria e inicializa o banco de dados SQLite. (SÍNCRONO)
const db = initializeDatabase();
// 2. Carrega as funções de consulta. (SÍNCRONO)
const queries = dbQueries(db); 

// --- Configuração do Bot ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction], 
});

// Acessível globalmente para comandos e eventos
client.db = db;
client.queries = queries; // ATRIBUIÇÃO FEITA ANTES DE QUALQUER CHAMADA ASSÍNCRONA
client.commands = new Collection();
client.commandArray = [];
client.pendingProofs = new Collection(); 
client.readyToFinalize = new Collection(); 
// ======================================================================
// --- ADIÇÕES PARA O NOVO FLUXO DE AUTENTICAÇÃO POR MENSAGEM ---
// ======================================================================
client.pendingAuth = new Collection(); // Armazena a ação pendente após o clique no botão gerencial
client.cachedModals = new Collection(); // Armazena o objeto Modal para ser aberto pelo botão pós-autenticação
// ======================================================================

// ----------------------------------------------------------------------
// --- FUNÇÃO DE CONEXÃO E CONFIGURAÇÃO ASSÍNCRONA DO DB (AGORA ESTÁ CORRETO) ---
// ----------------------------------------------------------------------
async function setupDatabaseAndConfig() {
    try {
        // 1. Conexão ao DB (client.queries JÁ ESTÁ DEFINIDO E DISPONÍVEL)
        await client.queries.connect();
        console.log('✅ Conectado ao banco de dados SQLite: database.sqlite');

        // 2. Criação de Tabelas (Garantir que existem)
        await client.queries.createTables(); 
        console.log('✅ Tabelas verificadas e configurações iniciais inseridas.');
        
        // 3. GARANTIR CONFIGURAÇÃO DE CARGOS GERENCIAIS
        const requiredManagerRoles = {
            ids: [
                "1427501248344490056",
                "1427511859963236494",
                "1427501594961907712",
                "1430305760079908975",
                "1427770640764506262"
            ]
        };
        
        let managerConfig = await client.queries.getConfig('CARGOS_GERENCIAIS');
        
        if (!managerConfig) {
            await client.queries.insertConfig('CARGOS_GERENCIAIS', requiredManagerRoles);
            console.log('✅ CARGOS_GERENCIAIS inserido no DB com sucesso.');
        } else {
            console.log('✅ CARGOS_GERENCIAIS já está configurado no DB.');
        }
        
        // ==================================================================
        // --- NOVO BLOCO: GARANTIR ITENS DE PRODUÇÃO (APENAS FARINHA) ---
        // ==================================================================
        // Usamos o formato Array de Objetos que é esperado pelo seu dbSetup.js
        const requiredProductionItemsArray = [
            { idInterno: 'farinha', nome: 'Farinha', multiplo: 1, min: null, max: null },
        ];

        let productionItemsConfig = await client.queries.getConfig('ITENS_PRODUCAO');

        // Se não existir OU se o valor for diferente do array de Farinha
        if (!productionItemsConfig || JSON.stringify(productionItemsConfig) !== JSON.stringify(requiredProductionItemsArray)) {
            await client.queries.insertConfig('ITENS_PRODUCAO', requiredProductionItemsArray);
            console.log('✅ ITENS_PRODUCAO inserido/atualizado no DB com sucesso (Apenas Farinha).');
        } else {
            console.log('✅ ITENS_PRODUCAO já está configurado no DB.');
        }
        // ==================================================================
        
        // ------------------------------------------------------------------
        // --- GARANTIR CHAVE MESTRA GERENCIAL (Tropa456) ---
        // ------------------------------------------------------------------
        const MASTER_KEY_VALUE = 'Tropa456';
        let masterKeyConfig = await client.queries.getConfig('CHAVE_MESTRA_GERENCIAL');

        if (!masterKeyConfig || masterKeyConfig.valor !== MASTER_KEY_VALUE) {
            // Se a chave não existir ou for diferente (para o caso de updates futuros)
            await client.queries.insertConfig('CHAVE_MESTRA_GERENCIAL', MASTER_KEY_VALUE);
            console.log(`✅ CHAVE_MESTRA_GERENCIAL inserida/atualizada no DB: ${MASTER_KEY_VALUE}`);
        } else {
            console.log('✅ CHAVE_MESTRA_GERENCIAL já está configurada no DB.');
        }
        // ------------------------------------------------------------------

    } catch (error) {
        console.error('❌ ERRO CRÍTICO na inicialização do banco de dados:', error);
        process.exit(1);
    }
}

// ----------------------------------------------------------------------
// --- LOADER CORRIGIDO (Suporta arquivos na raiz e subpastas) ---
// ----------------------------------------------------------------------

// Função auxiliar para evitar repetição de código (Lógica de registro)
function loadHandlerFile(client, filePath, handlersDir) {
    try {
        const handler = require(filePath);
        console.log(`[LOADER] Tentando carregar arquivo: ${filePath}`);
        
        if (handlersDir === 'commands' && handler.data) {
            client.commands.set(handler.data.name, handler);
            client.commandArray.push(handler.data.toJSON());
        } else if (handlersDir === 'events' && handler.name) {
            console.log(`[LOADER] Registrando evento: ${handler.name}`);
            if (handler.once) {
                client.once(handler.name, (...args) => handler.execute(...args, client));
            } else {
                client.on(handler.name, (...args) => handler.execute(...args, client));
            }
        }
    } catch (error) {
        console.error(`❌ [LOADER ERRO] Falha ao carregar ${filePath}:`, error.message);
    }
}

// Loader principal (Lógica de busca no sistema de arquivos)
function loadHandlers(client, handlersDir) {
    console.log(`\n[LOADER] Iniciando carregamento de: ${handlersDir}`);
    const handlersPath = path.join(__dirname, 'src', handlersDir);
    const handlerItems = fs.readdirSync(handlersPath); // Lê tudo (arquivos e pastas)

    for (const item of handlerItems) {
        const itemPath = path.join(handlersPath, item);
        const isDirectory = fs.statSync(itemPath).isDirectory();
        
        if (!isDirectory && item.endsWith('.js')) {
            loadHandlerFile(client, itemPath, handlersDir);
        } else if (isDirectory) {
            const files = fs.readdirSync(itemPath).filter(file => file.endsWith('.js'));
            for (const file of files) {
                const filePath = path.join(itemPath, file);
                loadHandlerFile(client, filePath, handlersDir);
            }
        }
    }
    console.log(`[LOADER] Carregamento de ${handlersDir} concluído.`);
}

// ----------------------------------------------------------------------
// --- Evento 'ready' (Quando o Bot está online) ---
// ----------------------------------------------------------------------
client.once('ready', async () => {
    console.log(`\n================================`);
    console.log(`✅ Bot online como ${client.user.tag}`);
    console.log(`================================`);
    
    // Carrega Comandos e Eventos
    loadHandlers(client, 'commands');
    loadHandlers(client, 'events');

    // -- Registro de Comandos (Slash Commands) --
    if (client.commandArray.length > 0) {
        try {
            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
            
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
                { body: client.commandArray },
            );
            
            console.log('✅ Comandos (/) registrados com sucesso!');
        } catch (error) {
            console.error('❌ Erro ao registrar comandos:', error.message);
        }
    }
});

// ----------------------------------------------------------------------
// --- INÍCIO: Conexão ao DB e Login do Bot ---
// ----------------------------------------------------------------------

// 1. Chama a função que conecta e configura o DB (assíncrono)
setupDatabaseAndConfig().then(() => {
    // 2. Só faz login DEPOIS que a conexão e configuração estiverem prontas
    client.login(process.env.DISCORD_TOKEN);
});