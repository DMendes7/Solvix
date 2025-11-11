// --- VARIÁVEIS GLOBAIS E CONSTANTES ---
const STORAGE_KEY = "financial-manager-transactions";

const INCOME_CATEGORIES = [
    "Salário",
    "Freelance",
    "Investimentos",
    "Presente",
    "Retirada de Reserva",
    "Outros"
];

const EXPENSE_CATEGORIES = [
    "Assinaturas",
    "Alimentação",
    "Transporte",
    "Combustível",
    "Moradia",
    "Saúde",
    "Educação",
    "Lazer",
    "Compras",
    "Contas",
    "Pagamento de Fatura", // Categoria especial
    "Outros"
];

const SUBSCRIPTION_LOGOS = {
    "Netflix": "https://upload.wikimedia.org/wikipedia/commons/0/08/Netflix_2015_logo.svg",
    "Spotify": "https://upload.wikimedia.org/wikipedia/commons/1/19/Spotify_logo_without_text.svg",
    "YouTube Premium": "https://upload.wikimedia.org/wikipedia/commons/0/09/YouTube_full-color_icon_%282017%29.svg",
    "Disney+": "https://upload.wikimedia.org/wikipedia/commons/3/3e/Disney%2B_logo.svg",
    "Crunchroll": "https://upload.wikimedia.org/wikipedia/commons/f/f6/Crunchyroll_Logo.svg",
    "SmartFit": "https://upload.wikimedia.org/wikipedia/commons/0/01/Smart_Fit_logo.svg",
    "Amazon Prime": "https://upload.wikimedia.org/wikipedia/commons/1/11/Amazon_Prime_Video_logo.svg",
    "Microsoft": "https://upload.wikimedia.org/wikipedia/commons/9/96/Microsoft_logo_%282012%29.svg",
    "iCloud+": "https://upload.wikimedia.org/wikipedia/commons/1/1c/ICloud_logo.svg",
    "GPT Plus": "https://upload.wikimedia.org/wikipedia/commons/0/04/ChatGPT_logo.svg",
    "Adobe": "https://upload.wikimedia.org/wikipedia/commons/7/7b/Adobe_Systems_logo_and_wordmark.svg"
};

let transactions = [];
let currentType = "expense"; // Inicializado como 'expense' para carregar as categorias de Gasto

// --- UTILITY FUNCTIONS ---
function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(value);
}

function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('pt-BR');
}

function saveTransactions() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
    } catch (error) {
        console.error("Erro ao salvar transações:", error);
    }
}

function loadTransactions() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        const loaded = data ? JSON.parse(data) : [];
        return loaded.map(t => ({
            ...t,
            isRecurring: t.isRecurring ?? false,
            logo: t.logo ?? undefined
        }));
    } catch (error) {
        console.error("Erro ao carregar transações:", error);
        return [];
    }
}

function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => {
            container.removeChild(toast);
        }, 300);
    }, 3000);
}

// --- CALCULATION AND RENDER ---
function calculateSummary() {
    const totalIncome = transactions
        .filter(t => t.type === "income")
        .reduce((sum, t) => sum + t.amount, 0);

    const totalExpenses = transactions
        .filter(t => t.type === "expense" && (t.paymentMethod === "debit" || t.category === "Pagamento de Fatura" || !t.paymentMethod))
        .reduce((sum, t) => sum + t.amount, 0);

    const totalCreditExpenses = transactions
        .filter(t => t.type === "expense" && t.paymentMethod === "credit" && t.category !== "Pagamento de Fatura")
        .reduce((sum, t) => sum + t.amount, 0);

    const totalInvoicePayments = transactions
        .filter(t => t.type === "expense" && t.category === "Pagamento de Fatura")
        .reduce((sum, t) => sum + t.amount, 0);

    const creditCardBill = Math.max(0, totalCreditExpenses - totalInvoicePayments);
    const balance = totalIncome - totalExpenses;

    return {
        totalIncome,
        totalExpenses,
        creditCardBill,
        balance
    };
}

function updateSummary() {
    const summary = calculateSummary();
    
    document.getElementById("totalIncome").textContent = formatCurrency(summary.totalIncome);
    document.getElementById("totalExpenses").textContent = formatCurrency(summary.totalExpenses);
    document.getElementById("creditCardBill").textContent = formatCurrency(summary.creditCardBill);
    document.getElementById("balance").textContent = formatCurrency(summary.balance);
    
    const balanceElement = document.getElementById("balance");
    balanceElement.style.color = summary.balance >= 0 ? 'hsl(var(--primary))' : 'hsl(var(--destructive))';
}

function renderTransactions() {
    const list = document.getElementById("transactionsList");
    
    if (transactions.length === 0) {
        list.innerHTML = '<div class="empty-state">Nenhuma transação cadastrada ainda</div>';
        return;
    }

    const sortedTransactions = transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    list.innerHTML = sortedTransactions.map(transaction => {
        const logo = transaction.logo || null;
        const descriptionText = transaction.description.trim() || transaction.category;
        const initial = descriptionText.charAt(0).toUpperCase();
        
        const logoHtml = logo 
            ? `<img src="${logo}" alt="${descriptionText}">` 
            : `<span class="transaction-logo-initial">${initial}</span>`;
            
        const paymentBadge = transaction.paymentMethod 
            ? `<span class="badge badge-${transaction.paymentMethod}">${transaction.paymentMethod === 'credit' ? 'Crédito' : 'Débito'}</span>` 
            : (transaction.category === "Pagamento de Fatura" ? `<span class="badge badge-debit">Débito</span>` : '');

        return `
            <div class="transaction-item">
                <div class="transaction-info">
                    <div class="transaction-logo">
                        ${logoHtml}
                    </div>
                    <div class="transaction-details">
                        <h4>${descriptionText}</h4>
                        <p>${transaction.category} • ${formatDate(transaction.date)}</p>
                    </div>
                </div>
                <div class="transaction-amount-section">
                    <span class="transaction-amount" style="color: ${transaction.type === 'income' ? 'hsl(var(--success))' : 'hsl(var(--destructive))'}">
                        ${transaction.type === 'income' ? '+' : '-'} ${formatCurrency(transaction.amount)}
                    </span>
                    ${paymentBadge}
                    <button class="btn-delete" onclick="deleteTransaction('${transaction.id}')">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 6h18"></path>
                            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function renderSubscriptions() {
    const list = document.getElementById("subscriptionsList");
    
    const subscriptions = transactions.filter(t => 
        t.type === "expense" && 
        t.category === "Assinaturas" && 
        t.isRecurring
    );

    if (subscriptions.length === 0) {
        list.innerHTML = '<div class="empty-state">Nenhuma assinatura ativa</div>';
        return;
    }

    const uniqueSubscriptions = {};
    subscriptions.forEach(sub => {
        if (!uniqueSubscriptions[sub.description] || 
            new Date(sub.createdAt) > new Date(uniqueSubscriptions[sub.description].createdAt)) {
            uniqueSubscriptions[sub.description] = sub;
        }
    });

    const debitSubs = Object.values(uniqueSubscriptions).filter(s => s.paymentMethod === "debit" || !s.paymentMethod);
    const creditSubs = Object.values(uniqueSubscriptions).filter(s => s.paymentMethod === "credit");

    let html = '';

    if (debitSubs.length > 0) {
        const totalDebit = debitSubs.reduce((sum, s) => sum + s.amount, 0);
        html += `
            <div class="subscription-section">
                <div class="subscription-header">
                    <span>Débito</span>
                    <span>${formatCurrency(totalDebit)}/mês</span>
                </div>
                ${debitSubs.map(sub => renderSubscriptionItem(sub)).join('')}
            </div>
        `;
    }

    if (creditSubs.length > 0) {
        const totalCredit = creditSubs.reduce((sum, s) => sum + s.amount, 0);
        html += `
            <div class="subscription-section">
                <div class="subscription-header">
                    <span>Crédito</span>
                    <span>${formatCurrency(totalCredit)}/mês</span>
                </div>
                ${creditSubs.map(sub => renderSubscriptionItem(sub)).join('')}
            </div>
        `;
    }

    list.innerHTML = html;
}

function renderSubscriptionItem(sub) {
    const logo = sub.logo || null;
    const descriptionText = sub.description.trim() || sub.category;
    const initial = descriptionText.charAt(0).toUpperCase();
    
    return `
        <div class="subscription-item">
            <div class="subscription-info">
                <div class="subscription-logo">
                    ${logo ? `<img src="${logo}" alt="${descriptionText}">` : `<span class="subscription-logo-initial">${initial}</span>`}
                </div>
                <div class="subscription-details">
                    <h4>${descriptionText}</h4>
                </div>
            </div>
            <span class="subscription-amount">${formatCurrency(sub.amount)}</span>
        </div>
    `;
}

function renderSuggestions() {
    const list = document.getElementById("suggestionsList");
    const summary = calculateSummary();
    
    if (transactions.length === 0) {
        list.innerHTML = '<div class="empty-state">Adicione transações para receber sugestões personalizadas</div>';
        return;
    }

    const suggestions = generateSuggestions(summary);
    
    list.innerHTML = suggestions.map(suggestion => `
        <div class="suggestion-item">
            <div class="suggestion-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                </svg>
            </div>
            <div class="suggestion-content">
                <div class="suggestion-header">
                    <span class="suggestion-type suggestion-${suggestion.type}">${suggestion.label}</span>
                </div>
                <p class="suggestion-text">${suggestion.text}</p>
            </div>
        </div>
    `).join('');
}

function generateSuggestions(summary) {
    const suggestions = [];
    const expenses = transactions.filter(t => t.type === "expense");
    
    if (expenses.length === 0) {
        return [{
            type: "info",
            label: "Dica",
            text: "Comece registrando seus gastos para receber sugestões personalizadas"
        }];
    }

    // Category analysis
    const categoryTotals = {};
    expenses.forEach(exp => {
        categoryTotals[exp.category] = (categoryTotals[exp.category] || 0) + exp.amount;
    });

    const topCategory = Object.keys(categoryTotals).reduce((a, b) => 
        categoryTotals[a] > categoryTotals[b] ? a : b
    );

    if (categoryTotals[topCategory] > summary.totalIncome * 0.3) {
        suggestions.push({
            type: "warning",
            label: "Atenção",
            text: `Seus gastos com ${topCategory} representam mais de 30% da sua renda. Considere reduzir nesta categoria.`
        });
    }

    // Spending rate
    if (summary.totalExpenses > summary.totalIncome * 0.8) {
        suggestions.push({
            type: "warning",
            label: "Alerta",
            text: "Você está gastando mais de 80% da sua renda. Tente economizar mais para criar uma reserva de emergência."
        });
    } else if (summary.balance > summary.totalIncome * 0.3) {
        suggestions.push({
            type: "success",
            label: "Parabéns",
            text: "Você está economizando mais de 30% da sua renda! Continue monitorando seus gastos!"
        });
    }

    // Subscriptions
    const subscriptions = expenses.filter(e => e.category === "Assinaturas" && e.isRecurring);
    if (subscriptions.length > 5) {
        suggestions.push({
            type: "info",
            label: "Dica",
            text: `Você tem ${subscriptions.length} assinaturas ativas. Revise quais você realmente usa e considere cancelar as que não são essenciais.`
        });
    }

    // Credit card bill
    if (summary.creditCardBill > summary.totalIncome * 0.5) {
        suggestions.push({
            type: "warning",
            label: "Atenção",
            text: "Sua fatura do cartão está alta. Tente pagar o quanto antes para evitar juros e usar mais o débito."
        });
    }

    return suggestions.length > 0 ? suggestions : [{
        type: "success",
        label: "Tudo certo",
        text: "Suas finanças estão equilibradas. Continue monitorando seus gastos!"
    }];
}

// --- FORM HANDLERS ---

/**
 * Popula o campo Select de Assinaturas com base no SUBSCRIPTION_LOGOS.
 */
function populateSubscriptionLogos() {
    const select = document.getElementById("subscriptionLogo");
    select.innerHTML = ''; // Limpa antes de popular
    
    // Placeholder
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Selecione o serviço (obrigatório)';
    defaultOption.disabled = true;
    defaultOption.selected = true;
    select.appendChild(defaultOption);

    // Opções Válidas
    for (const name in SUBSCRIPTION_LOGOS) {
        const option = document.createElement('option');
        option.value = SUBSCRIPTION_LOGOS[name]; 
        option.textContent = name; 
        select.appendChild(option);
    }
}

/**
 * Atualiza o <select> de categorias baseado no tipo atual (income/expense).
 */
function updateCategoryOptions() {
    const categorySelect = document.getElementById("category");
    // Guarda a categoria que estava selecionada antes da mudança
    const previouslySelectedCategory = categorySelect.value;
    
    // 1. Limpa o seletor
    categorySelect.innerHTML = ''; 
    
    // 2. Adiciona a opção padrão (placeholder)
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Selecione a Categoria';
    defaultOption.disabled = true;
    defaultOption.selected = true;
    categorySelect.appendChild(defaultOption);

    // 3. Define a lista de categorias correta
    const categories = currentType === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    
    // 4. Popula o seletor
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        categorySelect.appendChild(option);
    });
    
    // 5. Tenta manter a seleção anterior se ela for válida na nova lista.
    if (categories.includes(previouslySelectedCategory)) {
         categorySelect.value = previouslySelectedCategory;
    } else {
         // Se a categoria anterior não existir, volta ao placeholder
         categorySelect.value = '';
    }

    // 6. Atualiza a visibilidade dos campos com base no novo tipo/categoria
    toggleFormFields();
}


/**
 * Mostra/Esconde os campos adicionais (Valor, Meio de Pagamento, Assinatura/Logo, Recorrência)
 * baseado no Tipo (Entrada/Gasto) e na Categoria (Assinaturas, Pagamento de Fatura, etc.).
 */
function toggleFormFields() {
    const category = document.getElementById("category").value;
    const paymentMethodGroup = document.getElementById("paymentMethodGroup");
    const recurringGroup = document.getElementById("recurringGroup");
    const subscriptionLogoGroup = document.getElementById("subscriptionLogoGroup");
    const subscriptionLogoSelect = document.getElementById("subscriptionLogo");
    const amountInputGroup = document.getElementById("amount").parentElement; // Div .form-group do Valor
    const amountInput = document.getElementById("amount");
    const descriptionInput = document.getElementById("description"); // Elemento da Descrição

    const isExpense = currentType === "expense";
    const isSubscription = isExpense && category === 'Assinaturas';
    const isInvoicePayment = isExpense && category === 'Pagamento de Fatura';

    // 1. Visibilidade do campo Valor (amount)
    if (isInvoicePayment) {
        amountInputGroup.style.display = 'none';
        amountInput.removeAttribute('required');
    } else {
        amountInputGroup.style.display = 'block';
        amountInput.setAttribute('required', 'required');
    }

    // 2. Visibilidade do Meio de Pagamento
    if (isExpense && !isInvoicePayment) {
        paymentMethodGroup.style.display = "block";
    } else {
        paymentMethodGroup.style.display = "none";
    }

    // 3. Campos de Assinatura e Recorrência
    if (isSubscription) {
        recurringGroup.style.display = "block";
        subscriptionLogoGroup.style.display = "block";

        subscriptionLogoSelect.setAttribute('required', 'required');
        populateSubscriptionLogos();
        
        descriptionInput.placeholder = "Ex: Desconto anual (opcional)";
        descriptionInput.removeAttribute('required');

    } else {
        recurringGroup.style.display = "none";
        subscriptionLogoGroup.style.display = "none";
        subscriptionLogoSelect.removeAttribute('required');
        
        document.getElementById("isRecurring").checked = false;
        subscriptionLogoSelect.value = '';
        
        // Define o placeholder padrão (obrigatório para Gasto não-especial)
        descriptionInput.placeholder = "Ex: Conta de Luz";
        descriptionInput.setAttribute('required', 'required');
    }
    
    // 4. Exceção da Descrição para Pagamento de Fatura (Opcional)
    if (isInvoicePayment) {
        descriptionInput.placeholder = "Ex: Pago com Pix (opcional)";
        descriptionInput.removeAttribute('required');
    }

    // 5. Exceção da Descrição para Entrada (Opcional)
    if (!isExpense) {
        descriptionInput.placeholder = "Ex: Salário mensal (opcional)";
        descriptionInput.removeAttribute('required');
    }
}


function deleteTransaction(id) {
    transactions = transactions.filter(t => t.id !== id);
    saveTransactions();
    updateUI();
    showToast("Transação excluída com sucesso");
}

function updateUI() {
    updateSummary();
    renderTransactions();
    renderSubscriptions();
    renderSuggestions();
}

// --- EVENT LISTENERS E INICIALIZAÇÃO ---
document.addEventListener("DOMContentLoaded", () => {
    // Load transactions
    transactions = loadTransactions();
    updateUI();

    // Set today's date as default
    document.getElementById("date").valueAsDate = new Date();
    
    // Type toggle buttons
    const toggleButtons = document.querySelectorAll(".btn-toggle");
    toggleButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            toggleButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentType = btn.dataset.type;
            updateCategoryOptions(); 
        });
    });

    // Listener para Categoria
    document.getElementById("category").addEventListener("change", toggleFormFields);
    
    // Inicializa: Garante que as categorias de Gasto sejam carregadas e os campos estejam corretos
    const expenseBtn = document.querySelector('.btn-toggle[data-type="expense"]');
    if (expenseBtn) {
        expenseBtn.click(); // Simula o clique no Gasto
    } else {
        // Se o botão não existir, força a inicialização
        currentType = "expense"; 
        updateCategoryOptions();
    }


    // Form submission
    const form = document.getElementById("transactionForm");
    form.addEventListener("submit", (e) => {
        e.preventDefault();

        const category = document.getElementById("category").value;
        const date = document.getElementById("date").value;
        const isExpense = currentType === "expense";
        const isInvoicePayment = isExpense && category === "Pagamento de Fatura";
        const isSubscription = isExpense && category === "Assinaturas";

        // Variáveis de submissão
        let amount = 0;
        let paymentMethod = undefined;

        // 🚨 Tratamento do Pagamento de Fatura
        if (isInvoicePayment) {
            const summary = calculateSummary();
            amount = summary.creditCardBill;
            paymentMethod = 'debit'; 
            
            if (amount <= 0) {
                 showToast("Não há fatura pendente para pagar.", "error");
                 return;
            }
        } else {
            amount = parseFloat(document.getElementById("amount").value);
            paymentMethod = isExpense ? document.getElementById("paymentMethod").value : undefined;
        }

        const descriptionInput = document.getElementById("description").value.trim();
        const isRecurring = isSubscription ? document.getElementById("isRecurring").checked : false;

        
        // 🚨 Tratamento de Logo e Descrição
        const subscriptionLogoSelect = document.getElementById("subscriptionLogo");
        let logo = undefined;
        let description = descriptionInput;

        if (isSubscription) {
            // Se for Assinatura, o valor da descrição principal é o nome do serviço selecionado
            const selectedOption = subscriptionLogoSelect.options[subscriptionLogoSelect.selectedIndex];
            logo = subscriptionLogoSelect.value || undefined; 
            
            // O nome base da assinatura é o texto da opção selecionada
            description = selectedOption ? selectedOption.textContent : "Assinatura";
            
            // Se o usuário digitou uma descrição adicional, adiciona-a entre parênteses
            if (descriptionInput) {
                description = `${selectedOption.textContent} (${descriptionInput})`;
            } else {
                 description = selectedOption.textContent;
            }
        }
        
        // Define a descrição final para outros tipos
        if (!isSubscription && !isInvoicePayment) {
            description = descriptionInput || category; // Usa a categoria se a descrição for vazia
        } else if (isInvoicePayment) {
             description = `Pagamento de Fatura${descriptionInput ? ` (${descriptionInput})` : ''}`;
        }
        
        // Validação final de valor (só se aplica a transações que não são Pagamento de Fatura)
        if (!isInvoicePayment && (isNaN(amount) || amount <= 0 || !category || !date)) {
             showToast("Dados obrigatórios incompletos ou valor inválido!", "error");
             return;
        }
        
        // Se a descrição ainda estiver vazia e não for Pagamento de Fatura, usa a categoria.
        if (!description.trim() && !isInvoicePayment) {
            description = category;
        }


        const transaction = {
            id: Date.now().toString(),
            type: currentType,
            amount,
            category,
            description, 
            date,
            createdAt: new Date().toISOString(),
            paymentMethod,
            logo,
            isRecurring
        };

        transactions.unshift(transaction);
        saveTransactions();
        updateUI();

        // Reset form e UI
        form.reset();
        document.getElementById("date").valueAsDate = new Date();
        const expenseBtnToReset = document.querySelector('.btn-toggle[data-type="expense"]');
        if (expenseBtnToReset) {
            expenseBtnToReset.click(); // Volta para o padrão (Gasto)
        } else {
            updateCategoryOptions(); // Garante o reset do estado se o clique falhar
        }
        
        showToast("Transação adicionada com sucesso!");
    });
});

// Make functions available globally
window.deleteTransaction = deleteTransaction;