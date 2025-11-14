// --- CATEGORIAS E LOGOS (mantidas) ---
const INCOME_CATEGORIES = [
  "Salário",
  "Freelance",
  "Investimentos",
  "Presente",
  "Retirada de Reserva",
  "Outros",
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
  "Pagamento de Fatura",
  "Outros",
];

const SUBSCRIPTION_LOGOS = {
  "GPT Plus":
    "https://upload.wikimedia.org/wikipedia/commons/0/04/ChatGPT_logo.svg",
  "iCloud+":
    "https://upload.wikimedia.org/wikipedia/commons/1/1c/ICloud_logo.svg",
  "Netflix":
    "https://upload.wikimedia.org/wikipedia/commons/0/08/Netflix_2015_logo.svg",
  "Microsoft":
    "https://upload.wikimedia.org/wikipedia/commons/9/96/Microsoft_logo_%282012%29.svg",
  "Spotify":
    "https://upload.wikimedia.org/wikipedia/commons/1/19/Spotify_logo_without_text.svg",
  "YouTube Premium":
    "https://upload.wikimedia.org/wikipedia/commons/0/09/YouTube_full-color_icon_%282017%29.svg",
  "Disney+":
    "https://upload.wikimedia.org/wikipedia/commons/3/3e/Disney%2B_logo.svg",
  "Crunchroll":
    "https://upload.wikimedia.org/wikipedia/commons/f/f6/Crunchyroll_Logo.svg",
  "SmartFit":
    "https://upload.wikimedia.org/wikipedia/commons/0/01/Smart_Fit_logo.svg",
  "Amazon Prime":
    "https://upload.wikimedia.org/wikipedia/commons/1/11/Amazon_Prime_Video_logo.svg"
};

// --- ESTADO GLOBAL ---
let transactions = [];
let currentType = "expense"; // default
let billingInfo = null; // dados da fatura atual (API)
let futureInstallments = []; // parcelas futuras (API)

// --- HELPERS DE FORMATAÇÃO ---
function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
}

function formatDate(dateString) {
  // aceita "YYYY-MM-DD" ou ISO
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return dateString;
  return d.toLocaleDateString("pt-BR");
}

function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => container.removeChild(toast), 300);
  }, 3000);
}

// --- CHAMADAS À API (DB) ---
async function apiLoadTransactions() {
  const r = await fetch("/api/transactions");
  if (!r.ok) throw new Error("Falha ao carregar transações");
  return await r.json();
}

async function apiCreateTransaction(payload) {
  const r = await fetch("/api/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: "Erro ao salvar" }));
    throw new Error(err.error || "Erro ao salvar");
  }
  return await r.json();
}

async function apiDeleteTransaction(id) {
  const r = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: "Erro ao excluir" }));
    throw new Error(err.error || "Erro ao excluir");
  }
  return true;
}

// --- API de FATURA / PARCELAS ---
async function apiGetCurrentBill() {
  const r = await fetch("/api/billing/current");
  if (!r.ok) throw new Error("Falha ao carregar fatura");
  return await r.json();
}

async function apiPayCurrentBill(paymentDate) {
  const body = paymentDate ? { payment_date: paymentDate } : {};
  const r = await fetch("/api/billing/pay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: "Erro ao pagar fatura" }));
    throw new Error(err.error || "Erro ao pagar fatura");
  }
  return await r.json();
}

async function apiGetFutureInstallments() {
  const r = await fetch("/api/installments/future");
  if (!r.ok) throw new Error("Falha ao carregar parcelas futuras");
  return await r.json();
}

async function reloadBillingAndInstallments() {
  // Fatura
  try {
    billingInfo = await apiGetCurrentBill();
  } catch (e) {
    console.error(e);
    billingInfo = { total: 0, one_shot_total: 0, installments_total: 0 };
  }

  // Parcelas futuras
  try {
    futureInstallments = await apiGetFutureInstallments();
  } catch (e) {
    console.error(e);
    futureInstallments = [];
  }
}

// --- CÁLCULOS E RENDER ---
function calculateSummary() {
  const totalIncome = transactions
    .filter((t) => t.tipo === "income")
    .reduce((s, t) => s + Number(t.valor || 0), 0);

  // gastos que realmente saem do saldo (débito, boleto, pagamento de fatura etc.)
  const totalExpensesDebitOrFatura = transactions
    .filter(
      (t) =>
        t.tipo === "expense" &&
        (t.meio_pagamento === "debit" ||
          t.categoria === "Pagamento de Fatura" ||
          !t.meio_pagamento)
    )
    .reduce((s, t) => s + Number(t.valor || 0), 0);

  // Fatura: preferimos o valor vindo da API; se falhar, usamos fallback antigo
  let creditCardBill = 0;

  if (billingInfo && typeof billingInfo.total === "number") {
    creditCardBill = billingInfo.total;
  } else {
    const totalCreditExpenses = transactions
      .filter(
        (t) =>
          t.tipo === "expense" &&
          t.meio_pagamento === "credit" &&
          t.categoria !== "Pagamento de Fatura"
      )
      .reduce((s, t) => s + Number(t.valor || 0), 0);

    const totalInvoicePayments = transactions
      .filter(
        (t) => t.tipo === "expense" && t.categoria === "Pagamento de Fatura"
      )
      .reduce((s, t) => s + Number(t.valor || 0), 0);

    creditCardBill = Math.max(0, totalCreditExpenses - totalInvoicePayments);
  }

  const balance = totalIncome - totalExpensesDebitOrFatura;

  return {
    totalIncome,
    totalExpenses: totalExpensesDebitOrFatura,
    creditCardBill,
    balance,
  };
}

function updateSummary() {
  const s = calculateSummary();

  document.getElementById("totalIncome").textContent = formatCurrency(
    s.totalIncome
  );
  document.getElementById("totalExpenses").textContent = formatCurrency(
    s.totalExpenses
  );
  document.getElementById("creditCardBill").textContent = formatCurrency(
    s.creditCardBill
  );

  const balanceEl = document.getElementById("balance");
  balanceEl.textContent = formatCurrency(s.balance);
  balanceEl.style.color =
    s.balance >= 0 ? "hsl(var(--primary))" : "hsl(var(--destructive))";
}

function renderTransactions(){
  const list = document.getElementById("transactionsList");
  if (!transactions.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma transação cadastrada ainda</div>';
    return;
  }

  const sorted = [...transactions].sort((a, b) => new Date(b.data) - new Date(a.data));

  list.innerHTML = sorted.map(t => {
    const desc = (t.descricao || t.categoria || "").trim();

    // 🔹 Título exibido na lista (aqui entra o "(5x)")
    let title = desc || t.categoria;
    if (t.is_installment && t.installment_count > 1) {
      title += ` (${t.installment_count}x)`;
    }

    // ⭐️ Lógica de Geração do Logo/Ícone ⭐️
    let logoHtml;
    if (t.logo) {
      // 1. Caso Assinatura/Logo (MANTÉM IMAGEM)
      logoHtml = `<img src="${t.logo}" alt="${desc}">`;
    } else {
      // 2. Caso Sem Logo (USA ÍCONE DE TIPO)
      const isIncome = t.tipo === 'income';
      const arrow = isIncome
        ? '<polyline points="18 15 12 9 6 15"></polyline>' // seta pra cima
        : '<polyline points="6 9 12 15 18 9"></polyline>';   // seta pra baixo

      logoHtml = `
        <span class="transaction-logo-type ${isIncome ? 'income' : 'expense'}">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"
               viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            ${arrow}
          </svg>
        </span>`;
    }
    // ⭐️ FIM da lógica de logo/ícone ⭐️

    const badge = t.meio_pagamento
      ? `<span class="badge badge-${t.meio_pagamento}">
           ${t.meio_pagamento === 'credit' ? 'Crédito' : 'Débito'}
         </span>`
      : (t.categoria === "Pagamento de Fatura"
          ? `<span class="badge badge-debit">Débito</span>`
          : "");

    return `
      <div class="transaction-item">
        <div class="transaction-info">
          <div class="transaction-logo">${logoHtml}</div>
          <div class="transaction-details">
            <h4>${title}</h4>
            <p>${t.categoria} • ${formatDate(t.data)}</p>
          </div>
        </div>
        <div class="transaction-amount-section">
          <span class="transaction-amount"
                style="color:${t.tipo === 'income'
                  ? 'hsl(var(--success))'
                  : 'hsl(var(--destructive))'}">
            ${t.tipo === 'income' ? '+' : '-'} ${formatCurrency(t.valor)}
          </span>
          ${badge}
          <button class="btn-delete" onclick="deleteTransaction(${t.id})" title="Excluir">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18"></path>
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>`;
  }).join('');
}

function renderSubscriptions() {
  const list = document.getElementById("subscriptionsList");
  if (!list) return;

  const subs = transactions.filter(
    (t) =>
      t.tipo === "expense" &&
      t.categoria === "Assinaturas" &&
      !!t.recorrente
  );

  if (!subs.length) {
    list.innerHTML =
      '<div class="empty-state">Nenhuma assinatura ativa</div>';
    return;
  }

  const latest = {};
  subs.forEach((s) => {
    const key = s.descricao || s.categoria;
    if (
      !latest[key] ||
      new Date(s.created_at || s.data) >
        new Date(latest[key].created_at || latest[key].data)
    ) {
      latest[key] = s;
    }
  });

  const debit = Object.values(latest).filter(
    (s) => s.meio_pagamento === "debit" || !s.meio_pagamento
  );
  const credit = Object.values(latest).filter(
    (s) => s.meio_pagamento === "credit"
  );

  let html = "";
  if (debit.length) {
    const total = debit.reduce((sum, s) => sum + Number(s.valor || 0), 0);
    html += `
      <div class="subscription-section">
        <div class="subscription-header">
          <span>Débito</span>
          <span>${formatCurrency(total)}/mês</span>
        </div>
        ${debit.map(renderSubscriptionItem).join("")}
      </div>`;
  }
  if (credit.length) {
    const total = credit.reduce((sum, s) => sum + Number(s.valor || 0), 0);
    html += `
      <div class="subscription-section">
        <div class="subscription-header">
          <span>Crédito</span>
          <span>${formatCurrency(total)}/mês</span>
        </div>
        ${credit.map(renderSubscriptionItem).join("")}
      </div>`;
  }
  list.innerHTML = html;
}

function renderSubscriptionItem(sub) {
  const desc = (sub.descricao || sub.categoria || "").trim();
  const initial = (desc.charAt(0) || "?").toUpperCase();
  const logoHtml = sub.logo
    ? `<img src="${sub.logo}" alt="${desc}">`
    : `<span class="subscription-logo-initial">${initial}</span>`;
  return `
    <div class="subscription-item">
      <div class="subscription-info">
        <div class="subscription-logo">${logoHtml}</div>
        <div class="subscription-details">
          <h4>${desc || sub.categoria}</h4>
        </div>
      </div>
      <span class="subscription-amount">${formatCurrency(sub.valor)}</span>
    </div>`;
}

function renderSuggestions() {
  const list = document.getElementById("suggestionsList");
  if (!list) return;

  if (!transactions.length) {
    list.innerHTML =
      '<div class="empty-state">Adicione transações para receber sugestões personalizadas</div>';
    return;
  }
  const s = calculateSummary();
  const suggestions = generateSuggestions(s);
  list.innerHTML = suggestions
    .map(
      (su) => `
    <div class="suggestion-item">
      <div class="suggestion-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
        </svg>
      </div>
      <div class="suggestion-content">
        <div class="suggestion-header">
          <span class="suggestion-type suggestion-${su.type}">${su.label}</span>
        </div>
        <p class="suggestion-text">${su.text}</p>
      </div>
    </div>`
    )
    .join("");
}

function generateSuggestions(summary) {
  const res = [];
  const expenses = transactions.filter((t) => t.tipo === "expense");
  if (!expenses.length) {
    return [
      {
        type: "info",
        label: "Dica",
        text: "Comece registrando seus gastos para receber sugestões personalizadas",
      },
    ];
  }

  const byCat = {};
  expenses.forEach((e) => {
    byCat[e.categoria] = (byCat[e.categoria] || 0) + Number(e.valor || 0);
  });
  const top = Object.keys(byCat).reduce((a, b) =>
    byCat[a] > byCat[b] ? a : b
  );
  if (byCat[top] > summary.totalIncome * 0.3) {
    res.push({
      type: "warning",
      label: "Atenção",
      text: `Seus gastos com ${top} representam mais de 30% da sua renda. Considere reduzir nesta categoria.`,
    });
  }
  if (summary.totalExpenses > summary.totalIncome * 0.8) {
    res.push({
      type: "warning",
      label: "Alerta",
      text: "Você está gastando mais de 80% da sua renda. Tente economizar mais para criar uma reserva de emergência.",
    });
  } else if (summary.balance > summary.totalIncome * 0.3) {
    res.push({
      type: "success",
      label: "Parabéns",
      text: "Você está economizando mais de 30% da sua renda! Continue monitorando seus gastos!",
    });
  }
  const subs = expenses.filter(
    (e) => e.categoria === "Assinaturas" && e.recorrente
  );
  if (subs.length > 5) {
    res.push({
      type: "info",
      label: "Dica",
      text: `Você tem ${subs.length} assinaturas ativas. Revise quais realmente usa e considere cancelar as não essenciais.`,
    });
  }
  if (summary.creditCardBill > summary.totalIncome * 0.5) {
    res.push({
      type: "warning",
      label: "Atenção",
      text: "Sua fatura do cartão está alta. Pague o quanto antes para evitar juros e priorize débito.",
    });
  }
  return res.length
    ? res
    : [
        {
          type: "success",
          label: "Tudo certo",
          text: "Suas finanças estão equilibradas. Continue!",
        },
      ];
}

// --- PARCELAS FUTURAS ---
function renderFutureInstallments() {
  const container = document.getElementById("futureInstallmentsList");
  if (!container) return; // ainda não existe no HTML

  if (!futureInstallments.length) {
    container.innerHTML =
      '<div class="empty-state">Nenhuma parcela futura cadastrada</div>';
    return;
  }

  container.innerHTML = futureInstallments
    .map((group) => {
      const monthLabel = new Date(group.year, group.month - 1, 1)
        .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
        .replace(/^./, (c) => c.toUpperCase());

      const itemsHtml = group.items
        .map(
          (item) => `
        <div class="future-installment-item">
          <div class="future-installment-main">
            <span class="future-installment-title">${
              item.descricao || "Compra no crédito"
            }</span>
            <span class="future-installment-meta">
              Parcela ${item.installment_number}/${item.installments} • vence em ${formatDate(
            item.due_date
          )}
            </span>
          </div>
          <span class="future-installment-amount">
            ${formatCurrency(item.amount)}
          </span>
        </div>`
        )
        .join("");

      return `
        <div class="future-installment-group">
          <div class="future-installment-header">
            <span>${monthLabel}</span>
            <span>${formatCurrency(group.total)}</span>
          </div>
          ${itemsHtml}
        </div>`;
    })
    .join("");
}

// --- FORM / UI ---
function populateSubscriptionLogos() {
  const sel = document.getElementById("subscriptionLogo");
  if (!sel) return;

  sel.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = "Selecione o serviço (obrigatório)";
  ph.disabled = true;
  ph.selected = true;
  sel.appendChild(ph);
  for (const name in SUBSCRIPTION_LOGOS) {
    const opt = document.createElement("option");
    opt.value = SUBSCRIPTION_LOGOS[name];
    opt.textContent = name;
    sel.appendChild(opt);
  }
}

function updateCategoryOptions() {
  const categorySelect = document.getElementById("category");
  if (!categorySelect) return;

  const prev = categorySelect.value;
  categorySelect.innerHTML = "";
  const def = document.createElement("option");
  def.value = "";
  def.textContent = "Selecione a Categoria";
  def.disabled = true;
  def.selected = true;
  categorySelect.appendChild(def);

  const cats = currentType === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  cats.forEach((c) => {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c;
    categorySelect.appendChild(o);
  });

  categorySelect.value = cats.includes(prev) ? prev : "";
  toggleFormFields();
}

function toggleFormFields() {
  const categoryElement = document.getElementById("category");
  const paymentMethodGroup = document.getElementById("paymentMethodGroup");
  const recurringGroup = document.getElementById("recurringGroup");
  const logoGroup = document.getElementById("subscriptionLogoGroup");
  const logoSelect = document.getElementById("subscriptionLogo");
  const amountInputGroup = document.getElementById("amount")
    ? document.getElementById("amount").parentElement
    : null;
  const amountInput = document.getElementById("amount");
  const descInput = document.getElementById("description");
  const paymentMethodSelect = document.getElementById("paymentMethod");

  const installmentGroup = document.getElementById("installmentGroup");
  const installmentCountInput = document.getElementById("installmentCount");

  const category = categoryElement ? categoryElement.value : "";
  const isExpense = currentType === "expense";
  const isSubscription = isExpense && category === "Assinaturas";
  const isInvoicePayment = isExpense && category === "Pagamento de Fatura";
  const paymentMethod = paymentMethodSelect ? paymentMethodSelect.value : "";
  const isCreditExpense =
    isExpense &&
    !isInvoicePayment &&
    !isSubscription &&        
    paymentMethod === "credit";

  // amount
  if (amountInputGroup && amountInput) {
    if (isInvoicePayment) {
      amountInputGroup.style.display = "none";
      amountInput.removeAttribute("required");
    } else {
      amountInputGroup.style.display = "block";
      amountInput.setAttribute("required", "required");
    }
  }

  // meio de pagamento
  if (paymentMethodGroup) {
    paymentMethodGroup.style.display =
      isExpense && !isInvoicePayment ? "block" : "none";
  }

  // assinatura
  if (recurringGroup && logoGroup && descInput) {
    if (isSubscription) {
      recurringGroup.style.display = "block";
      logoGroup.style.display = "block";
      if (logoSelect) logoSelect.setAttribute("required", "required");
      populateSubscriptionLogos();
      descInput.placeholder = "Ex: Desconto anual (opcional)";
      descInput.removeAttribute("required");
    } else {
      recurringGroup.style.display = "none";
      logoGroup.style.display = "none";
      if (logoSelect) {
        logoSelect.removeAttribute("required");
        logoSelect.value = "";
      }
      const isIncome = currentType === "income";
      if (isIncome) {
        descInput.placeholder = "Ex: Salário mensal (opcional)";
        descInput.removeAttribute("required");
      } else if (isInvoicePayment) {
        descInput.placeholder = "Ex: Pago com Pix (opcional)";
        descInput.removeAttribute("required");
      } else {
        descInput.placeholder = "Ex: Conta de Luz";
        descInput.setAttribute("required", "required");
      }
    }
  }

  // Parcelamento (se campos existirem no HTML)
  if (installmentGroup && installmentCountInput) {
    if (isCreditExpense) {
      installmentGroup.style.display = "block";
    } else {
      installmentGroup.style.display = "none";
      installmentCountInput.value = "";
      const modeSel = document.getElementById("installmentMode");
      const interestInput = document.getElementById("interestPerMonth");
      if (modeSel) modeSel.value = "total";
      if (interestInput) interestInput.value = "";
    }
  }
}

// --- AÇÕES ---
async function deleteTransaction(id) {
  try {
    await apiDeleteTransaction(id);
    transactions = transactions.filter((t) => t.id !== id);
    await reloadBillingAndInstallments();
    updateUI();
    showToast("Transação excluída com sucesso");
  } catch (e) {
    console.error(e);
    showToast(e.message || "Erro ao excluir", "error");
  }
}

function updateUI() {
  updateSummary();
  renderTransactions();
  renderSubscriptions();
  renderSuggestions();
  renderFutureInstallments();
}

// --- INIT ---
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // carrega do DB
    transactions = await apiLoadTransactions();
  } catch (e) {
    console.error(e);
    showToast("Não foi possível carregar transações", "error");
    transactions = [];
  }

  await reloadBillingAndInstallments();
  updateUI();

  // data padrão hoje
  const dateInput = document.getElementById("date");
  if (dateInput) dateInput.valueAsDate = new Date();

  // toggles entrada/gasto
  const toggles = document.querySelectorAll(".btn-toggle");
  toggles.forEach((btn) => {
    btn.addEventListener("click", () => {
      toggles.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentType = btn.dataset.type;
      updateCategoryOptions();
    });
  });

  // categoria
  const categorySelect = document.getElementById("category");
  if (categorySelect) {
    categorySelect.addEventListener("change", toggleFormFields);
  }

  // meio de pagamento (para mostrar/esconder campo de parcelamento)
  const paymentMethodSelect = document.getElementById("paymentMethod");
  if (paymentMethodSelect) {
    paymentMethodSelect.addEventListener("change", toggleFormFields);
  }

  // inicia estado como "Gasto"
  const expenseBtn = document.querySelector(
    '.btn-toggle[data-type="expense"]'
  );
  if (expenseBtn) expenseBtn.click();
  else {
    currentType = "expense";
    updateCategoryOptions();
  }

  // submit
  const form = document.getElementById("transactionForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const category = document.getElementById("category")
      ? document.getElementById("category").value
      : "";
    const date = document.getElementById("date")
      ? document.getElementById("date").value
      : "";
    const isExpense = currentType === "expense";
    const isInvoicePayment =
      isExpense && category === "Pagamento de Fatura";
    const isSubscription = isExpense && category === "Assinaturas";

    const paymentMethodSelect = document.getElementById("paymentMethod");
    const paymentMethod = paymentMethodSelect
      ? paymentMethodSelect.value
      : undefined;

    // --- CASO ESPECIAL: PAGAMENTO DE FATURA ---
    if (isInvoicePayment) {
      try {
        const paymentResult = await apiPayCurrentBill(date || undefined);

        // recarrega tudo
        transactions = await apiLoadTransactions();
        await reloadBillingAndInstallments();
        updateUI();

        showToast(
          `Fatura paga com sucesso: ${formatCurrency(
            paymentResult.paid_amount
          )}`
        );

        form.reset();
        const expenseBtn2 = document.querySelector(
          '.btn-toggle[data-type="expense"]'
        );
        if (expenseBtn2) expenseBtn2.click();
        else {
          currentType = "expense";
          updateCategoryOptions();
        }
        if (dateInput) dateInput.valueAsDate = new Date();
      } catch (err) {
        console.error(err);
        showToast(err.message || "Erro ao pagar fatura", "error");
      }
      return;
    }

    // --- DEMAIS CASOS: entrada / gasto normal / assinaturas / parcelado ---

    let valor = 0;
    const amountInput = document.getElementById("amount");
    if (amountInput) {
      valor = parseFloat(amountInput.value);
    }

    const descInputValue = document.getElementById("description")
      ? document.getElementById("description").value.trim()
      : "";
    const recorrente = isSubscription
      ? document.getElementById("isRecurring").checked
      : false;

    const logoSel = document.getElementById("subscriptionLogo");
    let logo = undefined;
    let descricao = descInputValue;

    if (isSubscription) {
      const opt =
        logoSel && logoSel.options[logoSel.selectedIndex]
          ? logoSel.options[logoSel.selectedIndex]
          : null;
      logo = logoSel ? logoSel.value || undefined : undefined;
      descricao = opt ? opt.textContent : "Assinatura";
      if (descInputValue) descricao = `${opt.textContent} (${descInputValue})`;
    } else {
      descricao = descInputValue || category;
    }

    // validação simples
    if (isNaN(valor) || valor <= 0 || !category || !date) {
      showToast(
        "Dados obrigatórios incompletos ou valor inválido!",
        "error"
      );
      return;
    }

    // --- CAMPOS DE PARCELAMENTO (se existirem no HTML) ---
    let is_installment = false;
    let installment_mode = null;
    let installment_count = null;
    let interest_per_month = null;
    let first_due_date = date; // por padrão, mesma data da compra

    const installmentGroup = document.getElementById("installmentGroup");
    const installmentCountInput = document.getElementById(
      "installmentCount"
    );
    const installmentModeSelect =
      document.getElementById("installmentMode");
    const interestInput = document.getElementById("interestPerMonth");

    const isCreditExpense =
      isExpense && paymentMethod === "credit" && !isSubscription;

    if (
      installmentGroup &&
      installmentCountInput &&
      isCreditExpense &&
      installmentCountInput.value
    ) {
      const parsedCount = parseInt(installmentCountInput.value, 10);
      if (!Number.isNaN(parsedCount) && parsedCount > 1) {
        is_installment = true;
        installment_count = parsedCount;
        installment_mode = installmentModeSelect
          ? installmentModeSelect.value || "total"
          : "total";
        if (interestInput && interestInput.value) {
          const i = parseFloat(
            String(interestInput.value).replace(",", ".")
          );
          if (!Number.isNaN(i) && i > 0) {
            interest_per_month = i;
          }
        }
      }
    }

    const payload = {
      tipo: currentType,
      valor,
      categoria: category,
      descricao,
      data: date,
      meio_pagamento: isExpense ? paymentMethod : undefined,
      recorrente,
      logo,
      // parcelamento
      is_installment,
      installment_mode,
      installment_count,
      interest_per_month,
      first_due_date,
    };

    try {
      const saved = await apiCreateTransaction(payload);
      // adiciona no topo
      transactions.unshift(saved);
      await reloadBillingAndInstallments();
      updateUI();

      form.reset();
      if (dateInput) dateInput.valueAsDate = new Date();
      const expenseBtn3 = document.querySelector(
        '.btn-toggle[data-type="expense"]'
      );
      if (expenseBtn3) expenseBtn3.click();
      else {
        currentType = "expense";
        updateCategoryOptions();
      }

      showToast("Transação adicionada com sucesso!");
    } catch (e2) {
      console.error(e2);
      showToast(e2.message || "Erro ao salvar transação", "error");
    }
  });
});

// global para o botão de excluir
window.deleteTransaction = deleteTransaction;
