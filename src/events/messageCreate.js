// src/events/messageCreate.js

const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
// Importação corrigida para o módulo que contém finalizeTransaction e outras funções necessárias
const interactionCreate = require('./utility/interactionCreate');
// IMPORTAÇÕES AGORA USAM APENAS AS FUNÇÕES DE visualEmbeds necessárias.
const { createErrorEmbed, createPainelEmbed, createTransactionModal } = require('../functions/visualEmbeds'); 

// FUNÇÃO AUXILIAR PARA ATRASAR A EXECUÇÃO E EVITAR O RATE LIMIT
const delay = ms => new Promise(res => setTimeout(res, ms));

module.exports = {
    name: Events.MessageCreate,
    
    async execute(message, client) {
        
        // --- 1. FILTRO BÁSICO E INICIALIZAÇÃO ---
        if (message.author.bot) return;

        // ======================================================================
        // --- 1.5. FLUXO DE AUTENTICAÇÃO GERENCIAL POR MENSAGEM ---
        const pendingAction = client.pendingAuth.get(message.author.id);

        if (pendingAction) {
            
            const inputSenha = message.content.trim(); // A senha é o conteúdo da mensagem
            const masterKeyConfig = await client.queries.getConfig('CHAVE_MESTRA_GERENCIAL');
            const dbValue = masterKeyConfig && masterKeyConfig.valor ? masterKeyConfig.valor : masterKeyConfig;
            
            // 1. Senha Incorreta
            if (!dbValue || inputSenha !== dbValue) {
                // Notificação de falha (resposta ephmeral não é possível, então enviamos e deletamos)
                await message.reply({ 
                    embeds: [createErrorEmbed('Autenticação Falhou', 'Chave de acesso incorreta.')], 
                }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
                
                client.pendingAuth.delete(message.author.id);
                // Tentamos deletar a mensagem da senha para segurança
                message.delete().catch(() => {}); 
                return;
            }
            
            // 2. Senha Correta - Prepara e Executa a Ação

            client.pendingAuth.delete(message.author.id); // Limpa imediatamente o cache
            message.delete().catch(() => {}); // Deleta a mensagem da senha (obrigatório após sucesso)
            
            const authSuccessEmbed = new EmbedBuilder()
                .setColor('#5cb85c')
                .setTitle('✅ Autenticação Sucedida')
                .setDescription('Acesso gerencial concedido. Iniciando ação...');

            // Confirmação de acesso
            await message.reply({ embeds: [authSuccessEmbed], ephemeral: false })
                  .then(m => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
            // -----------------------------


            if (pendingAction === 'btn_log_gerencial') {
                // EXECUTA A LÓGICA DE LOG
                
                const logs = await client.queries.getTransacoes(null, 10);
                const embed = new EmbedBuilder()
                    .setColor('#5cb85c')
                    .setTitle(`📜 LOGS RECENTES (Últimas ${logs.length} Transações)`)
                    .setDescription(`**Filtro:** Todas as transações.\n\n`)
                    .setFooter({ text: 'Sistema de Controle' })
                    .setTimestamp();
                        
                if (logs.length === 0) {
                    embed.addFields({ name: 'Vazio', value: 'Nenhuma transação encontrada.' });
                } else {
                    logs.forEach(log => {
                        const targetUser = client.users.cache.get(log.alvoId) || { tag: log.alvoId };
                        const executorUser = client.users.cache.get(log.executorId) || { tag: log.executorId };
                        
                        let detalhesStr = '';
                        for (const [item, qty] of Object.entries(log.detalhes)) {
                            detalhesStr += `**${item.replace(/_/g, ' ').toUpperCase()}**: ${parseFloat(qty).toLocaleString('pt-BR')}\n`;
                        }
                        
                        embed.addFields({
                            name: `[#${log.transacaoId}] ${log.tipo} - Alvo: ${targetUser.tag}`,
                            value: `**Executado por**: ${executorUser.tag}\n**Status Prova**: ${log.statusProva}\n${detalhesStr}${log.urlProva ? `\n[🔗 Prova Anexada](${log.urlProva})` : ''}`,
                            inline: false
                        });
                    });
                }
                
                await message.channel.send({ content: `**${message.author.tag}**, Logs carregados:`, embeds: [embed] });
                return;


            } else if (pendingAction === 'btn_ajuste_estoque' || pendingAction === 'btn_producao') {
                
                // Prepara o Modal e o Cache
                const configKey = pendingAction === 'btn_ajuste_estoque' ? 'ITENS_FARM' : 'ITENS_PRODUCAO';
                const title = pendingAction === 'btn_ajuste_estoque' ? 'AJUSTE MANUAL DE ESTOQUE' : 'REGISTRO DE PRODUÇÃO';
                const modalId = pendingAction === 'btn_ajuste_estoque' ? 'modal_ajuste' : 'modal_producao';
                
                const items = await client.queries.getConfig(configKey);
                
                if (!items || items.length === 0) {
                     return message.channel.send({ embeds: [createErrorEmbed('Configuração Faltando', `Nenhum item encontrado para ${pendingAction}.`)] });
                }
                
                const modal = createTransactionModal(modalId, title, items);

                const openModalButton = new ButtonBuilder()
                    .setCustomId(`open_action_modal_${modalId}`) 
                    .setLabel(`Abrir Modal de ${pendingAction.split('_').pop().toUpperCase()}`)
                    .setStyle(ButtonStyle.Primary);

                const row = new ActionRowBuilder().addComponents(openModalButton);

                // Armazenar o modal pronto em cache (no interactionCreate, ele será puxado e aberto)
                client.cachedModals.set(message.author.id, modal);
                
                await message.channel.send({ 
                    content: `**${message.author.tag}**, autenticação bem-sucedida! Clique no botão abaixo para abrir o modal de transação.`, 
                    components: [row] 
                });
                
                return;
            }
        }
        // ======================================================================
        // --- FIM DO FLUXO DE AUTENTICAÇÃO ---
        // ======================================================================
        
        // Se a mensagem não foi a senha de autenticação, voltamos para o fluxo de prova (anexo)
        // Se a mensagem não tiver anexo, ignoramos (para não interferir com chats normais)
        if (message.attachments.size === 0) return;
        
        // 2. VERIFICAÇÃO DO DONO E CANAL
        let dono = null;
        try {
            dono = await client.queries.getUsuario(message.author.id);
        } catch (e) {
            console.error('[ERRO FATAL DB] Falha ao obter usuário do DB:', e);
            return;
        }

        if (!dono || dono.canalId !== message.channel.id) {
            return; // Ignora se não for o canal correto ou dono
        }
        
        // 3. VERIFICAÇÃO DE TRANSAÇÃO PENDENTE (Cache)
        let pendingData = null;
        let transacaoIdEncontrada = null; 

        for (const [transacaoId, data] of client.pendingProofs.entries()) {
            // Verifica se o canal e o usuário correspondem
            if (data.userId === message.author.id && data.alvoId === dono.discordId) {
                pendingData = data;
                transacaoIdEncontrada = transacaoId;
                break;
            }
        }
        
        if (!pendingData) {
            return; // Nenhuma prova pendente
        }

        // --- 4. FLUXO DE FINALIZAÇÃO (PROVA ANEXADA) ---
        // Garantindo que proofUrl é uma STRING.
        const proofUrl = message.attachments.first().url;
        
        // Remove do cache ANTES da finalização para evitar dupla execução
        client.pendingProofs.delete(transacaoIdEncontrada);

        try {
            // 4.1. FUNÇÃO PESADA (Atualiza DB, etc.).
            
            // Verificação de membro
            if (!message.member) {
                 await message.channel.send({ embeds: [createErrorEmbed('Erro Crítico', 'Não foi possível carregar os dados do membro do Discord.')] });
                 return;
            }

            // NOTE: A função finalizeTransaction (do interactionCreate) chama o createSuccessEmbed.
            const result = await interactionCreate.finalizeTransaction(
                message, 
                client, 
                pendingData, 
                'COM PROVA', 
                proofUrl, // Passando o URL da prova
                dono
            ); 

            // ----------------------------------------------------
            // A mensagem de confirmação de sucesso AGORA é enviada dentro de finalizeTransaction.
            // ----------------------------------------------------
            
            // ATRASO DE SEGURANÇA MÁXIMA (2.5s)
            await delay(2500); 

            // ----------------------------------------------------
            // PASSO 2: ENVIAR NOVO PAINEL (Feedback final)
            // ----------------------------------------------------
            
            const donoAtualizado = await client.queries.getUsuario(dono.discordId); 
            
            if (donoAtualizado && donoAtualizado.canalId) {
                const targetChannel = client.channels.cache.get(donoAtualizado.canalId);
                
                if (targetChannel) {
                    
                    // === INÍCIO DA CORREÇÃO DEFINITIVA (FORÇA BUSCA NA API) ===
                    let donoDoCanal = null;
                    try {
                        // Tenta buscar na API, garantindo o nome atualizado
                        donoDoCanal = await client.users.fetch(donoAtualizado.discordId);
                    } catch (e) {
                        console.error(`[ERRO BUSCA USER] Falha ao buscar usuário ${donoAtualizado.discordId}:`, e.message);
                    }
                    
                    // 2. Define a tag a ser usada, priorizando a tag atual do Discord.
                    // Se a busca falhar, cai no valor do DB, se não, cai em 'Admin' (Fallback)
                    const painelTag = donoDoCanal ? donoDoCanal.tag : (donoAtualizado.tag || 'Admin');
                    // === FIM DA CORREÇÃO ===
                    
                    const guildIconURL = message.guild ? message.guild.iconURL({ dynamic: true, size: 64 }) : null;
                    
                    // Usando a tag CORRIGIDA (painelTag)
                    const painelData = createPainelEmbed(painelTag, guildIconURL); 
                    
                    // O bot irá enviar o painel.
                    await targetChannel.send(painelData).catch(e => {
                        console.error("[ERRO ENVIO PAINEL] Falha ao enviar Painel atualizado:", e.message);
                    });
                }
            }
            
            // ----------------------------------------------------
            // PASSO 3: LIMPEZA VISUAL (DELETAR SÓ APÓS 3.5 SEGUNDOS)
            // ----------------------------------------------------
            
            setTimeout(async () => {
                try {
                    // 1. Deleta a mensagem do anexo (message atual)
                    await message.delete().catch(e => console.error("[ERRO LIMPEZA] Falha ao deletar a mensagem do anexo:", e.message));
                    
                    // 2. Limpa a mensagem do prompt de prova do BOT
                    const messages = await message.channel.messages.fetch({ limit: 5 });
                    const proofMessage = messages.find(m => 
                        m.author.id === client.user.id && 
                        m.embeds.some(e => e.title?.includes(transacaoIdEncontrada.toString()))
                    );

                    if (proofMessage) {
                        await proofMessage.delete().catch(e => console.error(`[ERRO LIMPEZA] Falha ao deletar a mensagem de prova #${transacaoIdEncontrada}:`, e.message));
                    }
                } catch (e) {
                    console.error("Falha na rotina de limpeza:", e);
                }
            }, 3500); 
            
        } catch (error) {
            console.error(`[ERRO CRÍTICO NA TRANSAÇÃO] A finalização FALHOU:`, error);
            
            const errorEmbed = createErrorEmbed('Erro Crítico', 'A transação falhou no processamento final. O registro não foi concluído.');
            await message.channel.send({ embeds: [errorEmbed] }).catch(() => {});
        }
        return; 
    },
};