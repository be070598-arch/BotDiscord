/**
 * Utilitários para validação de dados e cálculos de estoque.
 */

// --- Função 1: Valida as quantidades inseridas pelo usuário ---

/**
 * Valida as quantidades de itens inseridas no modal contra as regras de configuração.
 * @param {object} inputData Objeto com os valores inseridos pelo usuário (ex: { 'dinheiro_limpo': 4500, 'folhas': 10 }).
 * @param {Array<object>} configItems Lista de itens de configuração (ITENS_FARM ou ITENS_PRODUCAO).
 * @returns {Array<string>} Array de mensagens de erro. Vazio se válido.
 */
function validateInputQuantities(inputData, configItems) {
    const errors = [];
    const itemMap = new Map(configItems.map(item => [item.idInterno, item]));

    // Percorre apenas os itens que o usuário realmente inseriu
    for (const [key, valueStr] of Object.entries(inputData)) {
        const item = itemMap.get(key);
        if (!item) continue; // Ignora itens não mapeados (não deve ocorrer)

        const quantity = parseFloat(valueStr);

        // 1. Verifica se é um número válido e positivo
        if (isNaN(quantity) || quantity <= 0) {
            errors.push(`A quantidade para **${item.nome}** deve ser um número positivo.`);
            continue;
        }

        // 2. Verifica a regra de Múltiplo
        if (item.multiplo > 0 && quantity % item.multiplo !== 0) {
            errors.push(`A quantidade de **${item.nome}** precisa ser um múltiplo de ${item.multiplo.toLocaleString('pt-BR')}.`);
        }

        // 3. Verifica a regra de Mínimo
        if (item.min && quantity < item.min) {
            errors.push(`A quantidade mínima para **${item.nome}** é ${item.min.toLocaleString('pt-BR')}.`);
        }

        // 4. Verifica a regra de Máximo
        if (item.max && quantity > item.max) {
             errors.push(`A quantidade máxima permitida para **${item.nome}** é ${item.max.toLocaleString('pt-BR')}.`);
        }
    }

    // Se a inputData estiver vazia (usuário não preencheu nada)
    if (Object.keys(inputData).length === 0) {
         errors.push('Por favor, preencha a quantidade de pelo menos um item.');
    }

    return errors;
}

// --- Função 2: Função para somar ou subtrair o estoque ---

/**
 * Atualiza um estoque (Farm ou Produção) somando ou subtraindo valores.
 * @param {object} currentStock O estoque atual (objeto JS, não JSON string).
 * @param {object} transactionDetails Os valores a serem adicionados/removidos.
 * @param {number} multiplier Multiplicador: 1 para Soma (Registro/Produção), -1 para Subtração (Ajuste/Retirada).
 * @returns {object} O novo objeto de estoque atualizado.
 */
function updateStock(currentStock, transactionDetails, multiplier) {
    const newStock = { ...currentStock };
    
    for (const [itemId, quantityStr] of Object.entries(transactionDetails)) {
        const quantity = parseFloat(quantityStr) * multiplier; // Multiplica antes (soma ou subtrai)
        
        // Garante que o item existe antes de tentar somar/subtrair
        if (!newStock[itemId]) {
            newStock[itemId] = 0;
        }
        
        // Atualiza o estoque
        newStock[itemId] += quantity;
        
        // Remove entradas de estoque que fiquem zeradas ou negativas (limpeza de dados)
        if (newStock[itemId] <= 0) {
            delete newStock[itemId];
        }
    }
    
    return newStock;
}

// --- Função 3: Checa permissão Gerencial ---

/**
 * Checa se o membro tem um dos cargos gerenciais configurados.
 * @param {GuildMember} member O membro do Discord.
 * @param {Array<string>} requiredRoles Array de IDs dos cargos gerenciais.
 * @returns {boolean} True se tiver permissão, False caso contrário.
 */
function isManager(member, requiredRoles) {
    if (!member || !requiredRoles || requiredRoles.length === 0) return false;
    
    for (const roleId of requiredRoles) {
        if (member.roles.cache.has(roleId)) {
            return true;
        }
    }
    return false;
}

module.exports = {
    validateInputQuantities,
    updateStock,
    isManager
};