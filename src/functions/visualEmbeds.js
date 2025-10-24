// src/functions/visualEmbeds.js
const { 
    EmbedBuilder, ActionRowBuilder, TextInputBuilder, 
    TextInputStyle, ModalBuilder, 
    ButtonBuilder, ButtonStyle 
} = require('discord.js');

// ======================================================================
// --- 1. FUNÇÕES DE EMBED (Visualização) ---
// ======================================================================

/**
 * Cria um Embed padrão de sucesso para uma transação finalizada.
 *
 * @param {string} type - Tipo da transação ('REGISTRO', 'PRODUCAO', 'AJUSTE').
 * @param {string} transacaoId - ID da transação (JÁ CONVERTIDO para string).
 * @param {string} executorTag - Tag do usuário que executou a ação.
 * @param {object} details - Detalhes da transação (os itens {item: qty}).
 * @param {string|null} urlProva - URL do anexo de prova, se houver.
 * @param {import('discord.js').GuildMember} executor - Objeto do membro que executou.
 * @returns {EmbedBuilder} O objeto EmbedBuilder.
 */
function createSuccessEmbed(type, transacaoId, executorTag, details, urlProva, executor) {
    const embed = new EmbedBuilder()
        .setColor('#5cb85c') // Cor verde para sucesso
        .setTitle(`✅ Transação #${transacaoId} - ${type.toUpperCase()} CONCLUÍDA`)
        .setDescription(`A transação foi registrada com sucesso por **${executorTag}**.`)
        .setTimestamp()
        .setFooter({ text: `Finalizada por: ${executorTag}`, iconURL: executor.user.displayAvatarURL() });

    // Adicionar detalhes da transação
    let detailsStr = '';
    if (Object.values(details).length > 0) {
        detailsStr = Object.entries(details)
            .map(([item, qty]) => {
                const readableItem = item.replace(/_/g, ' ').toUpperCase();
                return `**${readableItem}**: ${parseFloat(qty).toLocaleString('pt-BR')}`;
            })
            .join('\n');
            
        embed.addFields({ name: 'Itens Registrados:', value: detailsStr, inline: false });
    } else {
         embed.addFields({ name: 'Itens Registrados:', value: 'N/A', inline: false });
    }

    // Adicionar campo de prova
    if (urlProva) {
        embed.addFields({ name: 'Comprovação', value: `[🔗 Clique para ver a Prova Anexada](${urlProva})`, inline: true });
    } else {
        embed.addFields({ name: 'Comprovação', value: 'Nenhuma prova anexada (Registro SEM PROVA).', inline: true });
    }

    return embed;
}

/**
 * Cria um Embed padrão de erro/aviso.
 * @param {string} title - Título da mensagem.
 * @param {string} description - Descrição principal.
 * @returns {EmbedBuilder} O objeto EmbedBuilder.
 */
function createErrorEmbed(title, description) {
    return new EmbedBuilder()
        .setColor('#d9534f') // Cor vermelha para erro
        .setTitle(`❌ ${title}`)
        .setDescription(description)
        .setTimestamp();
}

/**
 * Cria um Embed para notificar o usuário que a transação está pendente de prova.
 * @param {string} transacaoId - O ID da transação (JÁ CONVERTIDO para string).
 * @param {string} tipo - O tipo de transação (e.g., 'Produção').
 * @param {object} details - Detalhes dos itens envolvidos.
 * @returns {EmbedBuilder} O objeto EmbedBuilder.
 */
function createProofPendingEmbed(transacaoId, tipo, details) {
    const embed = new EmbedBuilder()
        .setColor('#f0ad4e') // Cor laranja/amarela para aviso/pendente
        .setTitle(`⚠️ Transação #${transacaoId} Pendente de Prova`)
        .setDescription(`Sua transação de **${tipo.toUpperCase()}** foi registrada e aguarda a prova. Por favor, **envie a imagem de comprovação** nesta conversa.`)
        .setTimestamp();
        
    let detailsStr = Object.entries(details)
        .map(([item, qty]) => {
            const readableItem = item.replace(/_/g, ' ').toUpperCase();
            return `**${readableItem}**: ${parseFloat(qty).toLocaleString('pt-BR')}`;
        })
        .join('\n');
            
    embed.addFields({ name: 'Itens Registrados:', value: detailsStr, inline: false });
    
    return embed;
}

/**
 * Cria um Embed para exibir o estoque atual.
 * * @param {string} tipo - Tipo de estoque ('CANAL' ou 'GERAL').
 * @param {object} estoqueData - Objeto contendo {item: quantidade}.
 * @param {string|null} [userTag=null] - Tag do usuário para consulta de canal.
 * @returns {EmbedBuilder} O objeto EmbedBuilder.
 */
function createStockEmbed(tipo, estoqueData, userTag = null) {
    const title = tipo === 'GERAL' ? '📦 ESTOQUE REAL GERAL' : `📦 ESTOQUE DO CANAL (${userTag || 'N/A'})`;
    
    const embed = new EmbedBuilder()
        .setColor('#2980b9') // Azul para informação/estoque
        .setTitle(title)
        .setTimestamp();
    
    let stockStr = '';
    
    if (Object.keys(estoqueData).length === 0) {
        stockStr = 'Nenhum item em estoque registrado.';
    } else {
        stockStr = Object.entries(estoqueData)
            .map(([item, qty]) => {
                 const readableItem = item.replace(/_/g, ' ').toUpperCase();
                 return `**${readableItem}**: ${parseFloat(qty).toLocaleString('pt-BR')}`;
            })
            .join('\n');
    }

    embed.setDescription(stockStr);
    
    return embed;
}


/**
 * Cria o Embed visual para o painel de controle do usuário/fazenda, incluindo os botões.
 *
 * @param {string} donoTag - A tag do usuário dono do canal (ex: 'Nome#1234').
 * @param {string|null} [guildIconURL=null] - A URL do ícone do servidor para o thumbnail.
 * @returns {object} Um objeto contendo o EmbedBuilder e os componentes.
 */
function createPainelEmbed(donoTag, guildIconURL = null) {
    
    // Garante que donoTag não é undefined/null
    const safeTag = donoTag || 'Admin'; 

    const embed = new EmbedBuilder()
        .setTitle('🛠️ Painel da Tropa 🏆')    
        .setColor('#0099ff')
        
        .setDescription(
            `**Boas-vindas, ${safeTag}**!    
             \nEste é o seu painel de controle de operações. Use os botões abaixo para registrar produção, ajustar estoque ou visualizar logs.
             \n**Status:** 🟢 Online e Operacional.`
        )
        
        .setThumbnail(guildIconURL)    
        
        .setFooter({ text: `Canal associado a ${safeTag}` })
        .setTimestamp();

    // ===========================================
    // CORREÇÃO: DEFINIÇÃO DOS BOTÕES
    // ===========================================

    // LINHA 1: Registro / Produção / Consulta
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_registro_farm')
            .setLabel('REGISTRO FARM')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('btn_producao')
            .setLabel('PRODUÇÃO')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('btn_consulta_estoque')
            .setLabel('CONSULTA ESTOQUE')
            .setStyle(ButtonStyle.Primary),
    );

    // LINHA 2: Ajuste / Log Gerencial
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_ajuste_estoque')
            .setLabel('AJUSTE ESTOQUE')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('btn_log_gerencial')
            .setLabel('LOG GERENCIAL')
            .setStyle(ButtonStyle.Secondary),
    );
    
    // ===========================================
    // CORREÇÃO: RETORNAR OS COMPONENTES
    // ===========================================
    return { 
        embeds: [embed],
        components: [row1, row2] 
    };
}


// ======================================================================
// --- 2. FUNÇÕES DE MODAL (Interação) ---
// ======================================================================

/**
 * Cria um Modal dinâmico com campos de texto baseados nos itens fornecidos.
 * @param {string} customId - ID único do modal.
 * @param {string} title - Título do modal.
 * @param {Array<Object>} items - Array de objetos de item ({idInterno, nome, ...}).
 * @returns {ModalBuilder} O objeto ModalBuilder.
 */
function createTransactionModal(customId, title, items) {
    const modal = new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title);

    items.forEach((item, index) => {
        // Limita a 5 TextInputs por Modal (limite do Discord)
        if (index >= 5) return;    

        const input = new TextInputBuilder()
            .setCustomId(item.idInterno)
            .setLabel(`Quantidade de ${item.nome}`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Digite a quantidade (ex: 500000)')
            .setRequired(false); // Deixar opcional

        const actionRow = new ActionRowBuilder().addComponents(input);
        modal.addComponents(actionRow);
    });

    return modal;
}

// ======================================================================
// --- 3. EXPORTAÇÃO ---
// ======================================================================
module.exports = {
    createSuccessEmbed,
    createErrorEmbed,
    createPainelEmbed,
    createTransactionModal,
    createProofPendingEmbed, 
    createStockEmbed, // <-- AGORA INCLUÍDA E EXPORTADA
};