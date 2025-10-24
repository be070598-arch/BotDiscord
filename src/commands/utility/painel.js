const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    EmbedBuilder 
} = require('discord.js');

const { createPainelEmbed, createErrorEmbed } = require('../../functions/visualEmbeds'); 

module.exports = {
    data: new SlashCommandBuilder()
        .setName('painel')
        .setDescription('Cria o painel de controle de estoque/produção no canal.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction, client) {
        
        await interaction.deferReply({ ephemeral: true }); 

        const dono = interaction.user;
        const canalId = interaction.channelId;
        const donoTag = dono.tag;
        
        const guildIconURL = interaction.guild ? interaction.guild.iconURL({ dynamic: true, size: 64 }) : null;
        
        // 1. Tenta registrar o Dono e o Canal no DB
        try {
            const success = await client.queries.registrarDono(dono.id, canalId, donoTag);
            
            if (!success) {
                 return interaction.editReply({ 
                    embeds: [createErrorEmbed('Erro no DB', 'Não foi possível registrar o dono e o canal no banco de dados.')],
                    ephemeral: true 
                });
            }

        } catch (error) {
             console.error('[ERRO REGISTRAR DONO] Falha ao registrar dono/canal no DB:', error);
             return interaction.editReply({ 
                embeds: [createErrorEmbed('Erro Crítico', 'Ocorreu um erro ao tentar salvar a configuração no banco de dados.')],
                ephemeral: true 
            });
        }
        
        // =========================================================
        // 2. CRIAÇÃO DOS BOTÕES (CINCO BOTÕES)
        // =========================================================
        
        // --- PRIMEIRA LINHA ---

        // 1. Botão de Registro FARM
        const btnRegistroFarm = new ButtonBuilder()
            .setCustomId('btn_registro_farm') // ID ASSUMIDA - VERIFIQUE!
            .setLabel('🌱 Registro Farm') 
            .setStyle(ButtonStyle.Success); // Verde

        // 2. Botão de Produção
        const btnProducao = new ButtonBuilder()
            .setCustomId('btn_producao') 
            .setLabel('🛠️ Registrar Produção') 
            .setStyle(ButtonStyle.Success); 

        // 3. Botão de Estoque (Visualização)
        const btnVisualizarEstoque = new ButtonBuilder()
            .setCustomId('btn_visualizar_estoque') // ID ASSUMIDA - VERIFIQUE!
            .setLabel('📈 Visualizar Estoque') 
            .setStyle(ButtonStyle.Primary); // Azul

        const row1 = new ActionRowBuilder().addComponents(btnRegistroFarm, btnProducao, btnVisualizarEstoque);
        
        // --- SEGUNDA LINHA ---

        // 4. Botão de Ajuste de Estoque
        const btnAjusteEstoque = new ButtonBuilder()
            .setCustomId('btn_ajuste_estoque') 
            .setLabel('📦 Ajuste Manual') 
            .setStyle(ButtonStyle.Primary); 

        // 5. Botão de Logs
        const btnLogs = new ButtonBuilder()
            .setCustomId('btn_log_gerencial') 
            .setLabel('📜 Logs de Transação') 
            .setStyle(ButtonStyle.Secondary); // Cinza

        const row2 = new ActionRowBuilder().addComponents(btnAjusteEstoque, btnLogs);


        // 3. Cria o Painel Visual (Chama a função que melhoramos no visualEmbeds.js)
        const painelData = createPainelEmbed(donoTag, guildIconURL);
        
        // 4. Envia o painel no canal com as DUAS linhas de botões
        await interaction.channel.send({
            embeds: painelData.embeds,
            components: [row1, row2] // Envia as duas ActionRows
        });
        
        // 5. Confirma o envio para o usuário que executou o comando
        await interaction.editReply({ 
            content: `✅ Painel de Controle criado com sucesso no canal! Você foi registrado como o Dono deste estoque.`,
            ephemeral: true 
        });
    },
};