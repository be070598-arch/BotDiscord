// src/events/interactionCreate.js

const { createErrorEmbed, createTransactionModal, createProofPendingEmbed, createStockEmbed, createSuccessEmbed, createPainelEmbed } = require('../../functions/visualEmbeds');
const { validateInputQuantities, updateStock } = require('../../functions/itemValidation');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

/**
 * Função utilitária para atrasar a execução de código.
 * @param {number} ms Milissegundos para esperar.
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Exporta a função principal do evento
module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        
        // --- 1. COMANDOS SLASH ---
        if (interaction.isCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (command) {
                try {
                    await command.execute(interaction, client);
                } catch (error) {
                    console.error(error);
                    const errorEmbed = createErrorEmbed('Erro ao Executar Comando', 'Ocorreu um erro ao tentar executar o comando. Verifique o console.');
                    if (interaction.deferred || interaction.replied) {
                        await interaction.editReply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
                    } else {
                        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
                    }
                }
            }
        }
        
        // Se não for um comando, deve ser um botão ou modal
        if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isAnySelectMenu()) return;
        
        // Busca o dono do canal para a maioria das interações
        // Ignora a busca apenas para o botão de consulta (btn_consulta_estoque) e fluxo de prova
        let dono = null;
        if (interaction.customId !== 'btn_consulta_estoque' && !interaction.customId.startsWith('proof_') && !interaction.customId.startsWith('open_action_modal_')) {
             dono = await client.queries.getUsuario(interaction.user.id);
             if (!dono && !interaction.customId.startsWith('auth_gerencial_modal_')) {
                 return interaction.reply({ 
                     embeds: [createErrorEmbed('Sem Painel', 'Você não é o dono do Painel de Controle neste canal. Use `/painel` para criar o seu.')],
                     ephemeral: true 
                 });
             }
        }
        
        // --- 2. INÍCIO DO FLUXO DE AUTENTICAÇÃO GERENCIAL (Botões de Acesso Restrito) ---
        // Aqui estão todos os botões que precisam de autenticação, incluídos os que restauramos
        const restrictedButtons = ['btn_ajuste_estoque', 'btn_log_gerencial', 'btn_producao', 'btn_visualizar_estoque']; // Adicionei btn_visualizar_estoque
        
        if (interaction.isButton() && restrictedButtons.includes(interaction.customId)) {
            // Se for um botão restrito, deferimos a resposta e enviamos uma mensagem de instrução.
            
            await interaction.deferReply({ ephemeral: true });
            
            // 1. Armazenar a ação que o usuário quer executar após a senha (no index.js: client.pendingAuth = new Map())
            client.pendingAuth.set(interaction.user.id, interaction.customId);
            
            // 2. Avisar o usuário para digitar a senha no canal.
            const instructionsEmbed = new EmbedBuilder()
                .setColor('#f0ad4e')
                .setTitle('🔒 Autenticação Necessária')
                .setDescription(`Por favor, **digite a Chave de Acesso Gerencial** diretamente no chat (sem comandos) nas próximas 60 segundos.`)
                .setFooter({ text: 'A senha é esperada na próxima mensagem. Apenas você verá a confirmação.' });

            await interaction.editReply({ embeds: [instructionsEmbed] });
            
            // 3. Limpar a sessão após 60 segundos
            setTimeout(() => {
                if (client.pendingAuth.get(interaction.user.id) === interaction.customId) {
                    client.pendingAuth.delete(interaction.user.id);
                }
            }, 60000); // 60 segundos
            
            return;
        }

        // --- 3. CLIQUE EM BOTÃO (Permitidos - Registro Farm/Consulta/Pós-Autenticação) ---
        if (interaction.isButton()) {
            
            // --- 3.1. BOTÃO REGISTRO FARM (Acesso Livre) ---
            if (interaction.customId === 'btn_registro_farm') {
                const configKey = 'ITENS_FARM';
                const title = 'REGISTRO DE ENTRADA FARM';
                const modalId = 'modal_registro_farm';
                
                const items = await client.queries.getConfig(configKey);
                
                if (!items || items.length === 0) {
                     await interaction.deferReply({ ephemeral: true });
                     return interaction.editReply({ embeds: [createErrorEmbed('Configuração Faltando', `Nenhum item de ${configKey.replace('_', ' ')} encontrado no banco de dados.`)] });
                }
                
                const modal = createTransactionModal(modalId, title, items);
                await interaction.showModal(modal);
                return; // Sai da função
            }

            // --- 3.2. NOVO BOTÃO DE ABRIR MODAL PÓS-AUTENTICAÇÃO ---
            if (interaction.customId.startsWith('open_action_modal_')) {
                const modal = client.cachedModals.get(interaction.user.id);
                
                if (!modal) {
                     await interaction.deferReply({ ephemeral: true });
                     return interaction.editReply({ embeds: [createErrorEmbed('Sessão Expirada', 'A sessão para este modal expirou. Tente a ação gerencial novamente.')] });
                }

                // Remove o cache após o uso
                client.cachedModals.delete(interaction.user.id);
                
                // Responde à interação do botão diretamente com o modal
                await interaction.showModal(modal);
                // Exclui a mensagem com o botão (opcional, dependendo do seu fluxo de deleção)
                await interaction.message.delete().catch(() => {});
                return;
            }

            // --- Se não for um modal de acesso livre/pós-auth, defere a resposta aqui para as interações que precisam de tempo ---
            if (!interaction.customId.startsWith('proof_')) {
                 await interaction.deferReply({ ephemeral: true });
            }
            
            // --- 3.3. BOTÃO DE CONSULTA ESTOQUE ---
            if (interaction.customId === 'btn_consulta_estoque') {
                const managerRolesConfig = await client.queries.getConfig('CARGOS_GERENCIAIS');
                const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

                let isManagerAccess = false;
                if (member) {
                    const { isManager } = require('../../functions/itemValidation');
                    isManagerAccess = isManager(member, managerRolesConfig ? managerRolesConfig.ids : []);
                }

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('select_consulta_estoque')
                    .setPlaceholder('Selecione o tipo de consulta...')
                    .addOptions([
                        {
                            label: 'Estoque do Meu Canal',
                            description: 'Consulta o estoque do dono deste canal.',
                            value: 'consulta_canal',
                        }
                    ]);
                
                if (isManagerAccess) {
                     selectMenu.addOptions({
                         label: 'Estoque Real Geral',
                         description: 'Consulta o estoque FARM total de todos os canais (Acesso via Cargo).',
                         value: 'consulta_geral',
                     });
                }

                const row = new ActionRowBuilder().addComponents(selectMenu);
                await interaction.editReply({ 
                    content: 'Escolha a opção de consulta:', 
                    components: [row],
                    ephemeral: true
                });
                return;
            }
            
            // --- 3.4. BOTÕES DE FLUXO DE PROVA (SIM / NÃO) ---
            if (interaction.customId.startsWith('proof_')) {
                const parts = interaction.customId.split('_');
                const action = parts[1]; // 'yes' ou 'no'
                const transacaoId = parseInt(parts[2]);
                
                const pendingData = client.pendingProofs.get(transacaoId);

                if (!pendingData || pendingData.userId !== interaction.user.id) {
                     await interaction.deferUpdate().catch(() => {});
                     return interaction.followUp({ embeds: [createErrorEmbed('Sessão Expirada', 'Esta sessão de prova expirou ou não pertence a você.')], ephemeral: true });
                }

                await interaction.deferReply({ ephemeral: true }); 
                
                // Lógica de NÃO (Registrar sem prova)
                if (action === 'no') {
                    const donoProof = await client.queries.getUsuario(pendingData.userId);
                    
                    const result = await finalizeTransaction(interaction, client, pendingData, 'SEM PROVA', null, donoProof);
                    client.pendingProofs.delete(transacaoId);
                    
                    // Deleta a mensagem original da pergunta (que agora está obsoleta)
                    await interaction.message.delete().catch(() => {});
                    
                    if (result && result.channelId) {
                            const targetChannel = client.channels.cache.get(result.channelId);
                            if (targetChannel) {
                                // Garantindo o guildIconURL
                                const guildIconURL = interaction.guild ? interaction.guild.iconURL({ dynamic: true, size: 64 }) : null;
                                const painelData = createPainelEmbed(result.tag, guildIconURL); 
                                await delay(1000); 
                                await targetChannel.send(painelData).catch(e => console.error("Erro ao enviar Painel:", e.message));
                            }
                    }
                    return interaction.editReply({ content: 'Transação registrada com sucesso (SEM PROVA).', embeds: [], components: [] });
                }
                
                // Lógica de SIM (Aguardar prova)
                if (action === 'yes') {
                    // createProofPendingEmbed retorna APENAS o EmbedBuilder.
                    const proofEmbed = createProofPendingEmbed(
                        transacaoId, 
                        pendingData.transacaoType, 
                        pendingData.details
                    ); 
                    
                    if (!proofEmbed) {
                         console.error(`[ERRO PROOF-EDIT] createProofPendingEmbed retornou NULL/UNDEFINED na transação #${transacaoId}.`);
                         return interaction.editReply({ embeds: [createErrorEmbed('Erro Interno', 'Falha ao processar dados de prova para edição.')], ephemeral: true });
                    }

                    // Edita a mensagem original para se tornar o PROMPT de anexo.
                    await interaction.message.edit({
                        embeds: [new EmbedBuilder()
                            .setColor(proofEmbed.data.color || '#f0ad4e')
                            .setTitle(proofEmbed.data.title || `Aguardando Prova da Transação #${transacaoId}`)
                            .setDescription('**Aguardando Anexo:** Por favor, anexe a imagem/prova no chat **agora**. (60s) **Se não conseguir, clique no botão "Não, registrar sem prova"**.')
                            .setFooter({ text: 'Aguardando imagem...' })
                        ],
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`proof_no_${transacaoId}`)
                                    .setLabel('Não, registrar sem prova')
                                    .setStyle(ButtonStyle.Secondary)
                            )
                        ]
                    });
                    
                    // Deleta o reply ephemeral (do deferReply)
                    return interaction.deleteReply();
                }
            }
        }
        
        // --- 4. SELEÇÃO DE MENU (Consulta de Estoque) ---
        if (interaction.isStringSelectMenu() && interaction.customId === 'select_consulta_estoque') {
            
            await interaction.deferUpdate(); 
            const selection = interaction.values[0];
            
            if (selection === 'consulta_canal') {
                const donoConsulta = await client.queries.getUsuario(interaction.user.id);
                if (!donoConsulta) {
                    return interaction.editReply({ embeds: [createErrorEmbed('Erro de Dados', 'Dono não encontrado no DB.')], components: [], ephemeral: true });
                }
                
                const estoqueEmbed = createStockEmbed("CANAL", donoConsulta.estoqueFarm, interaction.user.tag);
                await interaction.editReply({ embeds: [estoqueEmbed], components: [], ephemeral: true });
                
                if (donoConsulta.canalId) {
                    const targetChannel = client.channels.cache.get(donoConsulta.canalId);
                    if (targetChannel) {
                        // NOVO: Passando guildIconURL
                        const guildIconURL = interaction.guild ? interaction.guild.iconURL({ dynamic: true, size: 64 }) : null;
                        const painelData = createPainelEmbed(donoConsulta.tag, guildIconURL); 
                        await delay(1000); 
                        await targetChannel.send(painelData).catch(e => {
                            console.error("[ERRO ENVIO PAINEL] Falha ao enviar Painel atualizado após consulta de canal:", e.message);
                        });
                    }
                }
            } else if (selection === 'consulta_geral') {
                const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
                const { isManager } = require('../../functions/itemValidation');
                const managerRolesConfig = await client.queries.getConfig('CARGOS_GERENCIAIS');
                
                if (!member || !isManager(member, managerRolesConfig ? managerRolesConfig.ids : [])) {
                    const errorEmbed = createErrorEmbed('Acesso Negado', 'Você não tem permissão gerencial para esta consulta.');
                    return interaction.editReply({ embeds: [errorEmbed], components: [], ephemeral: true });
                }
                
                const allStocks = await client.queries.getAllFarmStocks();
                let estoqueGeral = {};
                allStocks.forEach(stock => {
                    estoqueGeral = updateStock(estoqueGeral, stock, 1); 
                });

                const estoqueEmbed = createStockEmbed("GERAL", estoqueGeral);
                await interaction.editReply({ embeds: [estoqueEmbed], components: [], ephemeral: true });
            }
        }

        // --- 5. SUBMISSÃO DE MODAL ---
        if (interaction.isModalSubmit()) {
            
            const values = {};
            
            // 5.1. Coleta e Limpa os Dados do Modal
            interaction.fields.fields.forEach((field, key) => {
                const rawValue = field.value.trim().replace(',', '.');
                if (rawValue && !isNaN(rawValue) && parseFloat(rawValue) !== 0) { 
                    values[key] = parseFloat(rawValue);
                }
            });
            
            // 5.2. Modal de AJUSTE (Execução)
            if (interaction.customId === 'modal_ajuste') {
                await interaction.deferReply({ ephemeral: true }); 
                
                if (Object.keys(values).length === 0) {
                     return interaction.editReply({ embeds: [createErrorEmbed('Dados Vazios', 'Preencha pelo menos um item. Use valores negativos para subtrair.')] });
                }
                
                const donoAjuste = await client.queries.getUsuario(interaction.user.id);
                if (!donoAjuste) {
                     return interaction.editReply({ embeds: [createErrorEmbed('Erro de Dados', 'Dono do Painel não encontrado no DB.')] });
                }
                
                const novoEstoqueFarm = updateStock(donoAjuste.estoqueFarm, values, 1); 
                const novoEstoqueProducao = donoAjuste.estoqueProducao; 
                const updateSuccess = await client.queries.updateEstoque(donoAjuste.discordId, novoEstoqueFarm, novoEstoqueProducao);

                if (updateSuccess) {
                    const transacaoId = await client.queries.addTransacao({ 
                        tipo: 'AJUSTE', 
                        executorId: interaction.user.id, 
                        alvoId: donoAjuste.discordId, 
                        detalhes: values, 
                        statusProva: 'AJUSTE',
                        urlProva: null
                    });
                    
                    const successEmbed = new EmbedBuilder()
                        .setColor('#5cb85c')
                        .setTitle(`🔧 AJUSTE MANUAL BEM-SUCEDIDO`)
                        .setDescription(`O estoque de **${donoAjuste.tag}** (ID: ${donoAjuste.discordId}) foi ajustado manualmente.`)
                        .addFields(
                            { name: 'Transação ID', value: `#${transacaoId}`, inline: true },
                            { name: 'Itens Ajustados', value: Object.entries(values).map(([k, v]) => `**${k.replace(/_/g, ' ').toUpperCase()}**: ${v.toLocaleString('pt-BR')}`).join('\n') || 'N/A' }
                        )
                        .setTimestamp();
                        
                    await interaction.channel.send({ embeds: [successEmbed] });
                    await interaction.deleteReply(); 
                    
                    if (donoAjuste.canalId) {
                            const targetChannel = client.channels.cache.get(donoAjuste.canalId);
                            if (targetChannel) {
                                // NOVO: Passando guildIconURL
                                const guildIconURL = interaction.guild ? interaction.guild.iconURL({ dynamic: true, size: 64 }) : null;
                                const painelData = createPainelEmbed(donoAjuste.tag, guildIconURL);
                                await delay(1000); 
                                await targetChannel.send(painelData).catch(e => console.error("[ERRO ENVIO PAINEL] Falha após ajuste:", e.message)); 
                            }
                    }
                    return;
                } else {
                     return interaction.editReply({ embeds: [createErrorEmbed('Erro no Ajuste', 'Não foi possível atualizar o estoque no banco de dados.')] });
                }
            }


            // 5.3. Modal de REGISTRO e PRODUÇÃO (Fluxo de Prova)
            if (interaction.customId === 'modal_registro_farm' || interaction.customId === 'modal_producao') {
                
                if (!dono) {
                    await interaction.reply({ embeds: [createErrorEmbed('Erro Interno', 'Dono do Painel não encontrado para registro.')], ephemeral: true });
                    return;
                }
                
                const configKey = interaction.customId === 'modal_registro_farm' ? 'ITENS_FARM' : 'ITENS_PRODUCAO';
                const itemsConfig = await client.queries.getConfig(configKey);
                
                const validationErrors = validateInputQuantities(values, itemsConfig);
                if (validationErrors.length > 0) {
                    await interaction.reply({ embeds: [createErrorEmbed('Dados Inválidos', validationErrors.join('\n'))], ephemeral: true });
                    return;
                }
                
                const tipoTransacao = configKey === 'ITENS_FARM' ? 'REGISTRO' : 'PRODUCAO';

                const transacaoId = await client.queries.addTransacao({ 
                    tipo: tipoTransacao, 
                    executorId: interaction.user.id, 
                    alvoId: dono.discordId, 
                    detalhes: values, 
                    statusProva: 'PENDENTE' 
                });
                
                if (!transacaoId) {
                     await interaction.reply({ embeds: [createErrorEmbed('Erro no Log', 'Não foi possível criar o registro da transação. Tente novamente.')], ephemeral: true });
                     return;
                }
                
                client.pendingProofs.set(transacaoId, {
                    userId: interaction.user.id,
                    alvoId: dono.discordId,
                    transacaoType: tipoTransacao,
                    details: values,
                    transacaoId: transacaoId
                });
                
                // CORREÇÃO FINAL BASEADA NO LOG: createProofPendingEmbed retorna APENAS o EmbedBuilder.
                const proofEmbed = createProofPendingEmbed(transacaoId, tipoTransacao, values);
                
                if (!proofEmbed || !proofEmbed.data) {
                    console.error('[ERRO FATAL] createProofPendingEmbed retornou um objeto EmbedBuilder inválido.');
                    await interaction.reply({ embeds: [createErrorEmbed('Erro Interno', 'Falha ao construir a mensagem de prova. Contate o administrador.')], ephemeral: true });
                    await client.queries.updateTransacaoStatus(transacaoId, 'FALHA_ENVIO', null);
                    return;
                }

                const components = [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`proof_yes_${transacaoId}`)
                            .setLabel('Sim, com prova')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`proof_no_${transacaoId}`)
                            .setLabel('Não, registrar sem prova')
                            .setStyle(ButtonStyle.Secondary)
                    )
                ];

                // Enviando o EmbedBuilder dentro de um array 'embeds'
                await interaction.channel.send({ embeds: [proofEmbed], components: components }); 

                try {
                     await interaction.reply({ content: 'Iniciando fluxo de prova...', ephemeral: true });
                     // Deletamos a resposta ephemeral para não poluir o chat
                     await interaction.deleteReply();
                } catch (e) {
                    // Já respondido/deletado, OK.
                }
                
                return;
            }
        }
    },
};

// --- Funções de Lógica Central (Usadas por eventCreate e messageCreate) ---

/**
 * Funções que atualiza o DB e envia a mensagem de sucesso final. 
 * NÃO ENVIA O PAINEL DE CONTROLE. RETORNA DADOS PARA QUE O CHAMADOR ENVIE O PAINEL.
 * @param {import('discord.js').Interaction|import('discord.js').Message} interactionOrMessage 
 * @param {object} client O cliente do Discord
 * @param {object} pendingData Dados da transação pendente
 * @param {string} status O novo status ('SEM PROVA', 'COM PROVA')
 * @param {string|null|undefined} urlProva URL da prova anexada (ajustado para aceitar null/undefined)
 * @param {object} dono Dados do dono (usuário)
 * @returns {object} Dados necessários para o chamador enviar o Painel.
 */
async function finalizeTransaction(interactionOrMessage, client, pendingData, status, urlProva, dono) {
    
    const executor = interactionOrMessage.member;
    
    // CORREÇÃO 1: Garante que urlProva é uma string ou null.
    let finalUrlProva = null;
    if (typeof urlProva === 'string' && urlProva.length > 0) {
        finalUrlProva = urlProva;
    } else {
        if (urlProva !== null && urlProva !== undefined) {
             console.warn(`[AVISO FINALIZE] urlProva recebido como tipo ${typeof urlProva} (${urlProva}). Forçando para null.`);
        }
    }


    // 1. Atualiza o status da transação no DB
    await client.queries.updateTransacaoStatus(pendingData.transacaoId, status, finalUrlProva);
    
    // 2. Atualiza o Estoque do Dono (Sempre soma no REGISTRO/PRODUCAO, por isso multiplier é 1)
    let novoEstoqueFarm = dono.estoqueFarm;
    let novoEstoqueProducao = dono.estoqueProducao;
    
    if (pendingData.transacaoType === 'REGISTRO') {
        novoEstoqueFarm = updateStock(dono.estoqueFarm, pendingData.details, 1);
    } else if (pendingData.transacaoType === 'PRODUCAO') {
        novoEstoqueProducao = updateStock(dono.estoqueProducao, pendingData.details, 1);
    }
    
    // 3. Salva os novos estoques
    await client.queries.updateEstoque(dono.discordId, novoEstoqueFarm, novoEstoqueProducao);

    // CORREÇÃO 2: Conversão do ID da Transação para String.
    const transacaoIdString = pendingData.transacaoId.toString();

    // 4. Envia a Embed de Sucesso no Canal
    const successEmbed = createSuccessEmbed(
        pendingData.transacaoType, 
        transacaoIdString, // Passando o ID como string para evitar erro de tipagem no EmbedBuilder
        executor.user.tag, 
        pendingData.details, 
        finalUrlProva, // Agora garantido que é string ou null
        executor
    );
    
    // Envia a mensagem de sucesso (API Call 1)
    await interactionOrMessage.channel.send({ embeds: [successEmbed] });

    await delay(1000); 

    // 5. RETORNA OS DADOS NECESSÁRIOS PARA O CHAMADOR ENVIAR O PAINEL
    return { 
        donoId: dono.discordId, 
        channelId: dono.canalId, 
        tag: dono.tag // Usar a tag do dono do painel, não do executor, para o painel
    };
}

// Exporta a função para ser usada pelo messageCreate e pelo fluxo do botão "Não"
module.exports.finalizeTransaction = finalizeTransaction;