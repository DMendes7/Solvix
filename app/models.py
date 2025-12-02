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

    # Associação ao usuário dono da transação
    # (preenchemos isso nas rotas com base no usuário logado)
    user_id = db.Column(db.Integer, nullable=True)

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
            "user_id": self.user_id,
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


# ============================================================
# NOVOS MODELOS – "CAIXINHAS" / RESERVAS (INVESTIMENTOS)
# ============================================================

class SavingBox(db.Model):
    """
    Caixinha / reserva de dinheiro (tipo porquinho/inter caixinhas).

    Cada usuário pode ter várias SavingBox. O saldo é calculado
    a partir dos movimentos (SavingMovement).
    """
    __tablename__ = "saving_boxes"

    id = db.Column(db.Integer, primary_key=True)

    # Dono da caixinha
    user_id = db.Column(db.Integer, nullable=False)

    # Nome da caixinha (ex.: "Reserva de Emergência", "Viagem", etc.)
    name = db.Column(db.String(100), nullable=False)

    # Descrição opcional
    description = db.Column(db.String(255), nullable=True)

    # Meta opcional (ex.: quero juntar 10.000 aqui)
    target_amount = db.Column(db.Float, nullable=True)

    # Marcar se a caixinha está arquivada / inativa
    archived = db.Column(db.Boolean, default=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relação com os movimentos
    movements = db.relationship(
        "SavingMovement",
        backref="box",
        cascade="all, delete-orphan",
        order_by="SavingMovement.date.desc()"
    )

    def current_balance(self) -> float:
        """
        Saldo calculado com base nos movimentos:
        depósitos somam, retiradas subtraem.
        """
        total = 0.0
        for m in self.movements:
            if m.type == "deposit":
                total += m.amount
            elif m.type == "withdraw":
                total -= m.amount
        return total

    def to_dict(self, include_movements: bool = False):
        data = {
            "id": self.id,
            "user_id": self.user_id,
            "name": self.name,
            "description": self.description,
            "target_amount": self.target_amount,
            "archived": self.archived,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "current_balance": self.current_balance(),
        }
        if include_movements:
            data["movements"] = [m.to_dict() for m in self.movements]
        return data


class SavingMovement(db.Model):
    """
    Movimento dentro de uma caixinha:

      - 'deposit'  -> dinheiro indo para a caixinha
      - 'withdraw' -> dinheiro saindo da caixinha (ex.: retorno para saldo disponível)
    """
    __tablename__ = "saving_movements"

    id = db.Column(db.Integer, primary_key=True)

    box_id = db.Column(
        db.Integer,
        db.ForeignKey("saving_boxes.id"),
        nullable=False
    )

    # Tipo de movimento: 'deposit' ou 'withdraw'
    type = db.Column(db.String(20), nullable=False)

    # Valor do movimento (sempre positivo; o sinal é interpretado pelo 'type')
    amount = db.Column(db.Float, nullable=False)

    # Data em que o movimento ocorreu (data lógica)
    date = db.Column(db.Date, nullable=False, default=date.today)

    # Descrição opcional (ex.: "Depósito mensal", "Resgate p/ conta corrente")
    description = db.Column(db.String(255), nullable=True)

    # Referência opcional à transação principal (quando houver integração)
    transaction_id = db.Column(
        db.Integer,
        db.ForeignKey("transaction.id"),
        nullable=True
    )

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "box_id": self.box_id,
            "type": self.type,
            "amount": self.amount,
            "date": self.date.isoformat() if self.date else None,
            "description": self.description,
            "transaction_id": self.transaction_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
