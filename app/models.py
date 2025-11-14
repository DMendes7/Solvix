from . import db
from datetime import datetime, date


class Transaction(db.Model):
    """
    Registro básico de movimentação financeira.

    Pode ser:
      - Entrada  (tipo = 'income')
      - Gasto    (tipo = 'expense', débito ou crédito)
      - Pagamento de fatura (categoria = 'Pagamento de Fatura')

    Também pode estar associado a um plano de parcelamento.
    """
    __tablename__ = "transaction"

    id = db.Column(db.Integer, primary_key=True)

    # Campos obrigatórios
    tipo = db.Column(db.String(10), nullable=False)          # 'income' ou 'expense'
    valor = db.Column(db.Float, nullable=False)              # valor principal informado
    categoria = db.Column(db.String(50), nullable=False)
    data = db.Column(db.Date, nullable=False, default=datetime.utcnow)

    # Campos opcionais
    descricao = db.Column(db.String(150), nullable=True)
    meio_pagamento = db.Column(db.String(20), nullable=True)  # 'credit', 'debit' ou None
    recorrente = db.Column(db.Boolean, default=False)
    logo = db.Column(db.String(250), nullable=True)

    # Controle geral
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Marcação para créditos à vista já quitados (será útil na fatura por ciclo)
    settled = db.Column(db.Boolean, default=False)

    # --------- Dados de Parcelamento (lado "resumo" da compra) ---------

    # Indica se esta transação representa uma COMPRA PARCELADA
    is_installment = db.Column(db.Boolean, default=False)

    # 'total'  -> valor informado é o valor total da compra
    # 'parcela' -> valor informado é o valor de cada parcela
    installment_mode = db.Column(db.String(20), nullable=True)

    # Quantidade de parcelas (2x, 3x, 10x, etc.)
    installment_count = db.Column(db.Integer, nullable=True)

    # Valor total da compra parcelada (já calculado no backend)
    total_amount = db.Column(db.Float, nullable=True)

    # Juros ao mês (%) se informado
    interest_per_month = db.Column(db.Float, nullable=True)

    # Data da primeira fatura em que a 1ª parcela vence
    first_due_date = db.Column(db.Date, nullable=True)

    # Relação 1:1 com o plano de parcelas
    installment_plan = db.relationship(
        "InstallmentPlan",
        backref="transaction",
        uselist=False,
        cascade="all, delete-orphan"
    )

    def to_dict(self):
        """
        Representação usada pelo front-end (JSON).
        Mantém compatibilidade com o que o app.js espera,
        mas já expõe os campos de parcelamento para futuras telas.
        """
        return {
            "id": self.id,
            "tipo": self.tipo,
            "valor": self.valor,
            "categoria": self.categoria,
            "descricao": self.descricao,
            "data": self.data.isoformat() if self.data else None,
            "meio_pagamento": self.meio_pagamento,
            "recorrente": self.recorrente,
            "logo": self.logo,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "settled": self.settled,
            "is_installment": self.is_installment,
            "installment_mode": self.installment_mode,
            "installment_count": self.installment_count,
            "total_amount": self.total_amount,
            "interest_per_month": self.interest_per_month,
            "first_due_date": self.first_due_date.isoformat() if self.first_due_date else None,
        }


class InstallmentPlan(db.Model):
    """
    Plano de parcelamento de uma compra no crédito.

    Ex.: "Notebook (3x)" -> total 3.000, 3 parcelas, com ou sem juros.
    Cada plano está vinculado a UMA Transaction de resumo.
    """
    __tablename__ = "installment_plans"

    id = db.Column(db.Integer, primary_key=True)

    # Transação de origem (gasto no crédito que gerou o plano)
    transaction_id = db.Column(
        db.Integer,
        db.ForeignKey("transaction.id"),
        nullable=False
    )

    descricao = db.Column(db.String(150), nullable=True)

    # Valor total (já considerando se foi enviado como total ou como parcela * n)
    total_amount = db.Column(db.Float, nullable=False)

    # Quantidade de parcelas
    installments = db.Column(db.Integer, nullable=False)

    # 'total' ou 'parcela' (como o usuário informou o valor)
    mode = db.Column(db.String(20), nullable=True)

    # Juros ao mês (%) se informado
    interest_per_month = db.Column(db.Float, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Parcelas individuais
    charges = db.relationship(
        "InstallmentCharge",
        backref="plan",
        cascade="all, delete-orphan",
        order_by="InstallmentCharge.installment_number"
    )

    def __repr__(self):
        return f"<InstallmentPlan id={self.id} total={self.total_amount}x{self.installments}>"


class InstallmentCharge(db.Model):
    """
    Parcela individual de um plano de parcelamento.

    Ex.: parcela 1/3 do Notebook, R$ 1.000,00, vencimento 10/11/2025.
    """
    __tablename__ = "installment_charges"

    id = db.Column(db.Integer, primary_key=True)

    plan_id = db.Column(
        db.Integer,
        db.ForeignKey("installment_plans.id"),
        nullable=False
    )

    # 1, 2, 3, ... N
    installment_number = db.Column(db.Integer, nullable=False)

    # Valor desta parcela específica
    amount = db.Column(db.Float, nullable=False)

    # Data de vencimento desta parcela
    due_date = db.Column(db.Date, nullable=False)

    # Se a parcela já foi quitada (por pagamento de fatura)
    paid = db.Column(db.Boolean, default=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def __repr__(self):
        return (
            f"<InstallmentCharge plan={self.plan_id} "
            f"n={self.installment_number} amount={self.amount} due={self.due_date}>"
        )
