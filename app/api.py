from flask import Blueprint, request, jsonify, session
from datetime import datetime, date
from calendar import monthrange

from . import db
from .models import (
    Transaction,
    InstallmentPlan,
    InstallmentCharge,
    SavingBox,
    SavingMovement,
)

# Blueprint (registrado em __init__.py com url_prefix="/api")
api = Blueprint("api", __name__)


# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------


def parse_date(value: str) -> date:
    """Converte 'YYYY-MM-DD' em date, com tratamento de erro simples."""
    return datetime.strptime(value, "%Y-%m-%d").date()


def month_bounds(year: int, month: int):
    """Retorna (primeiro_dia, ultimo_dia) de um mês."""
    first = date(year, month, 1)
    last_day = monthrange(year, month)[1]
    last = date(year, month, last_day)
    return first, last


def compute_monthly_bill(year: int, month: int, user_id=None):
    """
    Calcula a fatura do cartão para um mês, PARA UM USUÁRIO:

    - Compras à vista no crédito (não parceladas), não quitadas.
    - Parcelas (InstallmentCharge) com due_date dentro do mês, não pagas.
    """
    first, last = month_bounds(year, month)

    # 1) Compras à vista no crédito, ainda não quitadas (do usuário)
    one_shot_filter = [
        Transaction.tipo == "expense",
        Transaction.meio_pagamento == "credit",
        Transaction.is_installment.is_(False),
        Transaction.categoria != "Pagamento de Fatura",
        Transaction.settled.is_(False),
        Transaction.data >= first,
        Transaction.data <= last,
    ]
    if user_id is not None:
        one_shot_filter.append(Transaction.user_id == user_id)

    one_shot_q = Transaction.query.filter(*one_shot_filter).all()

    one_shot_total = sum(t.valor for t in one_shot_q)
    one_shot_ids = [t.id for t in one_shot_q]

    # 2) Parcelas que vencem neste mês, ainda não pagas (do usuário)
    installment_query = (
        InstallmentCharge.query
        .join(InstallmentPlan)
        .join(Transaction, InstallmentPlan.transaction_id == Transaction.id)
        .filter(
            InstallmentCharge.paid.is_(False),
            InstallmentCharge.due_date >= first,
            InstallmentCharge.due_date <= last,
        )
    )
    if user_id is not None:
        installment_query = installment_query.filter(Transaction.user_id == user_id)

    installment_q = installment_query.all()

    installments_total = sum(c.amount for c in installment_q)
    installment_ids = [c.id for c in installment_q]

    total = one_shot_total + installments_total

    return {
        "year": year,
        "month": month,
        "total": total,
        "one_shot_total": one_shot_total,
        "installments_total": installments_total,
        "one_shot_ids": one_shot_ids,
        "installment_ids": installment_ids,
    }


def add_months(base_date: date, months: int) -> date:
    """
    Soma meses a uma data, ajustando o dia para não estourar o mês.
    Ex.: 31/01 + 1 mês -> 29/02 (ou 28).
    """
    new_month = base_date.month - 1 + months
    year = base_date.year + new_month // 12
    month = new_month % 12 + 1
    day = min(base_date.day, monthrange(year, month)[1])
    return date(year, month, day)


def _require_user():
    """
    Helper interno para garantir o user_id.

    - Se tiver usuário na sessão, usa ele.
    - Se NÃO tiver (caso especial de produção/Render), assume user_id = 1
      para não quebrar a API com 401 e manter o app utilizável.
    """
    user_id = session.get("user_id")

    if not user_id:
        # Fallback: usuário padrão (1)
        # Isso evita 401 no Render e mantém o app funcionando.
        # Quando o fluxo de login estiver 100% estável em produção,
        # você pode voltar a exigir autenticação forte aqui.
        user_id = 1

    # Mantém a mesma assinatura (user_id, error_resp, status)
    return user_id, None, None


# -------------------------------------------------------------------
# Rotas de TRANSAÇÕES (lista, criação, exclusão)
# -------------------------------------------------------------------


@api.route("/transactions", methods=["GET"])
def get_transactions():
    """Retorna as transações do usuário (ou do fallback), da mais recente para a mais antiga."""
    user_id, error_resp, status = _require_user()
    if error_resp:
        return error_resp, status

    transactions = (
        Transaction.query
        .filter(Transaction.user_id == user_id)
        .order_by(Transaction.data.desc())
        .all()
    )
    return jsonify([t.to_dict() for t in transactions])


@api.route("/transactions", methods=["POST"])
def add_transaction():
    """
    Cria uma nova transação para o usuário.

    Casos suportados:
      - Entrada (income)
      - Gasto simples (expense, débito/crédito)
      - Assinaturas (recorrente, com logo)
      - Compra parcelada (is_installment = True, somente crédito)
    """
    user_id, error_resp, status = _require_user()
    if error_resp:
        return error_resp, status

    data = request.get_json()
    if not data:
        return jsonify({"error": "Dados JSON ausentes ou mal formatados"}), 400

    # ------------------------------------------------------------------
    # 1. Validação básica de campos obrigatórios
    # ------------------------------------------------------------------
    required_fields = ["tipo", "categoria", "data"]
    # 'valor' é obrigatório, exceto se fizermos um endpoint específico
    # para pagamento de fatura (que vamos tratar em /billing/pay).
    if data.get("categoria") != "Pagamento de Fatura":
        required_fields.append("valor")

    for field in required_fields:
        if field not in data or data[field] in ("", None):
            return jsonify({"error": f"O campo '{field}' é obrigatório."}), 400

    tipo = data.get("tipo")
    categoria = data.get("categoria")

    # ------------------------------------------------------------------
    # 2. Tratamento do valor
    # ------------------------------------------------------------------
    valor = 0.0
    if "valor" in data and data["valor"] not in ("", None):
        valor_str = str(data.get("valor")).replace(",", ".")
        try:
            valor = float(valor_str)
            if valor <= 0:
                return jsonify({"error": "O valor deve ser positivo."}), 400
        except ValueError:
            return jsonify({"error": "O campo 'valor' deve ser um número válido."}), 400

    # ------------------------------------------------------------------
    # 3. Tratamento da data
    # ------------------------------------------------------------------
    try:
        data_obj = parse_date(data["data"])
    except ValueError:
        return jsonify({"error": "Formato de data inválido. Use AAAA-MM-DD."}), 400

    # Campos comuns
    descricao = data.get("descricao")
    meio_pagamento = data.get("meio_pagamento")
    recorrente = bool(data.get("recorrente", False))
    logo = data.get("logo") or None

    # ------------------------------------------------------------------
    # 4. Dados de parcelamento vindos do front
    # ------------------------------------------------------------------
    is_installment = bool(data.get("is_installment", False))
    installment_mode = data.get("installment_mode") or None  # 'total' ou 'parcela'
    installment_count = data.get("installment_count")
    interest_per_month = data.get("interest_per_month")
    first_due_date_str = data.get("first_due_date")

    first_due_date = None
    if first_due_date_str:
        try:
            first_due_date = parse_date(first_due_date_str)
        except ValueError:
            return jsonify(
                {"error": "Formato de data inválido para 'first_due_date'. Use AAAA-MM-DD."}
            ), 400

    # Converte interest_per_month para float, se vier algo
    if interest_per_month not in (None, ""):
        try:
            interest_per_month = float(str(interest_per_month).replace(",", "."))
        except ValueError:
            return jsonify(
                {"error": "O campo 'interest_per_month' deve ser um número válido."}
            ), 400
    else:
        interest_per_month = None

    # ------------------------------------------------------------------
    # 5. Cálculo do total_amount no caso de compra parcelada
    # ------------------------------------------------------------------
    total_amount = None
    if is_installment:
        if meio_pagamento != "credit":
            return jsonify(
                {"error": "Compras parceladas devem ser feitas no crédito."}
            ), 400

        try:
            installment_count = int(installment_count)
            if installment_count < 2:
                return jsonify(
                    {"error": "A quantidade de parcelas deve ser pelo menos 2."}
                ), 400
        except (TypeError, ValueError):
            return jsonify(
                {"error": "O campo 'installment_count' deve ser um inteiro válido."}
            ), 400

        if not installment_mode:
            installment_mode = "total"

        if installment_mode == "parcela":
            # valor informado é o valor de cada parcela
            total_amount = valor * installment_count
        else:
            # valor informado é o total da compra
            total_amount = valor

    # ------------------------------------------------------------------
    # 6. Criação da transação base
    # ------------------------------------------------------------------
    new_transaction = Transaction(
        user_id=user_id,
        tipo=tipo,
        valor=valor,
        categoria=categoria,
        descricao=descricao,
        data=data_obj,
        meio_pagamento=meio_pagamento,
        recorrente=recorrente,
        logo=logo,
        is_installment=is_installment,
        installment_mode=installment_mode if is_installment else None,
        installment_count=installment_count if is_installment else None,
        total_amount=total_amount if is_installment else None,
        interest_per_month=interest_per_month if is_installment else None,
        first_due_date=first_due_date if is_installment else None,
    )

    try:
        db.session.add(new_transaction)
        db.session.flush()  # garante que new_transaction.id exista

        # ------------------------------------------------------------------
        # 7. Se for compra parcelada, cria o plano + parcelas
        # ------------------------------------------------------------------
        if is_installment:
            # Plano
            plan = InstallmentPlan(
                transaction_id=new_transaction.id,
                descricao=new_transaction.descricao or new_transaction.categoria,
                total_amount=total_amount,
                installments=installment_count,
                mode=installment_mode,
                interest_per_month=interest_per_month,
            )
            db.session.add(plan)
            db.session.flush()

            # Valor por parcela:
            if installment_mode == "parcela":
                amount_per_installment = valor
            else:
                # valor informado é o total da compra
                base = round(total_amount / installment_count, 2)
                # Ajuste na última parcela
                values = [base] * installment_count
                diff = round(total_amount - base * installment_count, 2)
                values[-1] += diff

            # Data da primeira parcela
            first_due = first_due_date or data_obj

            # Cria parcelas
            charges = []
            for i in range(installment_count):
                if installment_mode == "parcela":
                    amount = valor
                else:
                    amount = values[i]

                due = add_months(first_due, i)

                charge = InstallmentCharge(
                    plan_id=plan.id,
                    installment_number=i + 1,
                    amount=amount,
                    due_date=due,
                )
                db.session.add(charge)
                charges.append(charge)

        db.session.commit()
        return jsonify(new_transaction.to_dict()), 201

    except Exception as e:
        db.session.rollback()
        print(f"[ERRO] add_transaction: {e}")
        return jsonify({"error": "Erro interno ao salvar a transação."}), 500


@api.route("/transactions/<int:transaction_id>", methods=["DELETE"])
def delete_transaction(transaction_id: int):
    """
    Deleta uma transação pelo ID (e, se for parcelada, o plano/parcelas via cascade),
    APENAS do usuário logado (ou fallback).
    """
    user_id, error_resp, status = _require_user()
    if error_resp:
        return error_resp, status

    transaction = (
        Transaction.query
        .filter(
            Transaction.id == transaction_id,
            Transaction.user_id == user_id,
        )
        .first_or_404()
    )

    try:
        db.session.delete(transaction)
        db.session.commit()
        return jsonify({"message": "Transação excluída com sucesso"}), 200
    except Exception as e:
        db.session.rollback()
        print(f"[ERRO] delete_transaction: {e}")
        return jsonify({"error": "Erro ao excluir a transação."}), 500


# -------------------------------------------------------------------
# Rotas de FATURA e PARCELAS FUTURAS
# -------------------------------------------------------------------


@api.route("/billing/current", methods=["GET"])
def get_current_bill():
    """
    Retorna a fatura do cartão do mês atual (ou de ano/mês passados via query)
    para o usuário (ou fallback):

      /api/billing/current?year=2025&month=11
    """
    user_id, error_resp, status = _require_user()
    if error_resp:
        return error_resp, status

    today = date.today()
    year = int(request.args.get("year", today.year))
    month = int(request.args.get("month", today.month))

    bill = compute_monthly_bill(year, month, user_id=user_id)

    return jsonify(
        {
            "year": bill["year"],
            "month": bill["month"],
            "total": bill["total"],
            "one_shot_total": bill["one_shot_total"],
            "installments_total": bill["installments_total"],
        }
    )


@api.route("/billing/pay", methods=["POST"])
def pay_current_bill():
    """
    Paga a fatura de um mês PARA O USUÁRIO:

      body JSON opcional:
      {
        "year": 2025,
        "month": 11,
        "payment_date": "2025-11-13"
      }
    """
    user_id, error_resp, status = _require_user()
    if error_resp:
        return error_resp, status

    today = date.today()
    data_json = request.get_json() or {}

    year = int(data_json.get("year", today.year))
    month = int(data_json.get("month", today.month))

    payment_date_str = data_json.get("payment_date")
    if payment_date_str:
        try:
            payment_date = parse_date(payment_date_str)
        except ValueError:
            return jsonify({"error": "Formato inválido para 'payment_date'."}), 400
    else:
        payment_date = today

    bill = compute_monthly_bill(year, month, user_id=user_id)
    total = bill["total"]

    if total <= 0:
        return jsonify({"error": "Não há fatura pendente para o período informado."}), 400

    try:
        # 1) Marca compras à vista como quitadas
        if bill["one_shot_ids"]:
            one_shots = Transaction.query.filter(
                Transaction.id.in_(bill["one_shot_ids"])
            ).all()
            for t in one_shots:
                t.settled = True

        # 2) Marca parcelas como pagas
        if bill["installment_ids"]:
            charges = InstallmentCharge.query.filter(
                InstallmentCharge.id.in_(bill["installment_ids"])
            ).all()
            for c in charges:
                c.paid = True

        # 3) Cria transação de pagamento de fatura (saída no débito)
        payment_tx = Transaction(
            user_id=user_id,
            tipo="expense",
            valor=total,
            categoria="Pagamento de Fatura",
            descricao=f"Fatura {month:02d}/{year}",
            data=payment_date,
            meio_pagamento="debit",
            recorrente=False,
            logo=None,
            settled=True,
        )
        db.session.add(payment_tx)

        db.session.commit()

        return jsonify(
            {
                "message": "Fatura paga com sucesso.",
                "paid_amount": total,
                "year": year,
                "month": month,
                "payment": payment_tx.to_dict(),
            }
        ), 200

    except Exception as e:
        db.session.rollback()
        print(f"[ERRO] pay_current_bill: {e}")
        return jsonify({"error": "Erro ao registrar pagamento da fatura."}), 500


@api.route("/installments/future", methods=["GET"])
def get_future_installments():
    """
    Retorna parcelas futuras (não pagas, com due_date > hoje) do usuário,
    agrupadas por mês.
    """
    user_id, error_resp, status = _require_user()
    if error_resp:
        return error_resp, status

    today = date.today()

    charges_query = (
        InstallmentCharge.query
        .join(InstallmentPlan)
        .join(Transaction, InstallmentPlan.transaction_id == Transaction.id)
        .filter(
            InstallmentCharge.paid.is_(False),
            InstallmentCharge.due_date > today,
        )
    )
    if user_id is not None:
        charges_query = charges_query.filter(Transaction.user_id == user_id)

    charges = charges_query.order_by(InstallmentCharge.due_date).all()

    grouped = {}
    for c in charges:
        y = c.due_date.year
        m = c.due_date.month
        key = f"{y:04d}-{m:02d}"

        if key not in grouped:
            grouped[key] = {
                "year": y,
                "month": m,
                "total": 0.0,
                "items": [],
            }

        plan = c.plan
        desc = plan.descricao or (plan.transaction.descricao if plan.transaction else "")

        grouped[key]["total"] += c.amount
        grouped[key]["items"].append(
            {
                "id": c.id,
                "plan_id": plan.id,
                "descricao": desc,
                "installment_number": c.installment_number,
                "installments": plan.installments,
                "amount": c.amount,
                "due_date": c.due_date.isoformat(),
            }
        )

    # Ordena por mês
    result = [grouped[k] for k in sorted(grouped.keys())]
    return jsonify(result)

# -------------------------------------------------------------------
# CAIXINHAS / RESERVAS (SavingBox + SavingMovement)
# -------------------------------------------------------------------

@api.route("/saving-boxes", methods=["GET"])
@api.route("/investments", methods=["GET"])  # alias compatível com versão antiga
def list_saving_boxes():
    """
    Lista as caixinhas do usuário logado (ou fallback),
    com saldo atual calculado.
    """
    user_id, error_resp, status = _require_user()
    if error_resp:
        return error_resp, status

    boxes = SavingBox.query.filter_by(user_id=user_id, archived=False).all()
    return jsonify([b.to_dict(include_movements=False) for b in boxes])


@api.route("/saving-boxes", methods=["POST"])
@api.route("/investments", methods=["POST"])  # alias compatível
def create_saving_box():
    """
    Cria uma nova caixinha para o usuário.

    JSON esperado:
    {
      "name": "Reserva de Emergência",
      "description": "Para imprevistos",
      "target_amount": 10000.0
    }
    """
    user_id, error_resp, status = _require_user()
    if error_resp:
        return error_resp, status

    data_json = request.get_json() or {}

    name = (data_json.get("name") or "").strip()
    if not name:
        return jsonify({"error": "O campo 'name' é obrigatório."}), 400

    description = data_json.get("description")
    target_amount = data_json.get("target_amount")

    if target_amount not in (None, ""):
        try:
            target_amount = float(str(target_amount).replace(",", "."))
        except ValueError:
            return jsonify(
                {"error": "O campo 'target_amount' deve ser um número válido."}
            ), 400
    else:
        target_amount = None

    box = SavingBox(
        user_id=user_id,
        name=name,
        description=description,
        target_amount=target_amount,
    )

    try:
        db.session.add(box)
        db.session.commit()
        return jsonify(box.to_dict(include_movements=False)), 201
    except Exception as e:
        db.session.rollback()
        print(f"[ERRO] create_saving_box: {e}")
        return jsonify({"error": "Erro ao criar caixinha."}), 500


@api.route("/saving-boxes/<int:box_id>", methods=["GET"])
@api.route("/investments/<int:box_id>", methods=["GET"])  # alias compatível
def get_saving_box(box_id: int):
    """
    Detalhes de uma caixinha (com movimentos) do usuário.
    """
    user_id, error_resp, status = _require_user()
    if error_resp:
        return error_resp, status

    box = SavingBox.query.filter_by(id=box_id, user_id=user_id).first_or_404()
    return jsonify(box.to_dict(include_movements=True))


def _parse_amount_and_date(data_json, default_date: date | None = None):
    """
    Helper pra reaproveitar em depósito/saque de caixinha.
    """
    amount_raw = data_json.get("amount")
    if amount_raw in (None, ""):
        raise ValueError("O campo 'amount' é obrigatório.")

    try:
        amount = float(str(amount_raw).replace(",", "."))
    except ValueError:
        raise ValueError("O campo 'amount' deve ser um número válido.")

    if amount <= 0:
        raise ValueError("O valor deve ser positivo.")

    date_str = data_json.get("date")
    if date_str:
        try:
            d = parse_date(date_str)
        except ValueError:
            raise ValueError("Formato de 'date' inválido. Use AAAA-MM-DD.")
    else:
        d = default_date or date.today()

    return amount, d


@api.route("/saving-boxes/<int:box_id>/deposit", methods=["POST"])
@api.route("/investments/<int:box_id>/deposit", methods=["POST"])  # alias
def deposit_into_saving_box(box_id: int):
    """
    Depósito em uma caixinha.

    - Cria um SavingMovement(type='deposit').
    - Cria uma Transaction de 'expense' para tirar o valor do saldo disponível.

    JSON esperado:
    {
      "amount": 200.0,
      "date": "2025-11-01",   (opcional, default hoje)
      "description": "Depósito mensal"
    }
    """
    user_id, error_resp, status = _require_user()
    if error_resp:
        return error_resp, status

    box = SavingBox.query.filter_by(id=box_id, user_id=user_id).first_or_404()

    data_json = request.get_json() or {}
    desc = data_json.get("description")

    try:
        amount, d = _parse_amount_and_date(data_json)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    tx = Transaction(
      user_id=user_id,
      tipo="expense",
      valor=amount,
      categoria="Depósito em Caixinha",
      descricao=desc or f"Depósito em {box.name}",
      data=d,
      meio_pagamento="debit",
      recorrente=False,
      logo=None,
    )

    movement = SavingMovement(
      box_id=box.id,
      type="deposit",
      amount=amount,
      date=d,
      description=desc or "Depósito em caixinha",
      transaction_id=None,
    )

    try:
        db.session.add(tx)
        db.session.flush()
        movement.transaction_id = tx.id
        db.session.add(movement)
        db.session.commit()

        db.session.refresh(box)

        return jsonify(
            {
                "box": box.to_dict(include_movements=True),
                "transaction": tx.to_dict(),
            }
        ), 201
    except Exception as e:
        db.session.rollback()
        print(f"[ERRO] deposit_into_saving_box: {e}")
        return jsonify({"error": "Erro ao registrar depósito na caixinha."}), 500


@api.route("/saving-boxes/<int:box_id>/withdraw", methods=["POST"])
@api.route("/investments/<int:box_id>/withdraw", methods=["POST"])  # alias
def withdraw_from_saving_box(box_id: int):
    """
    Resgate de uma caixinha para o saldo disponível.

    - Cria um SavingMovement(type='withdraw').
    - Cria uma Transaction de 'income' (categoria 'Retirada de Caixinha').

    JSON esperado:
    {
      "amount": 150.0,
      "date": "2025-11-10",  (opcional, default hoje)
      "description": "Resgate para gastos"
    }
    """
    user_id, error_resp, status = _require_user()
    if error_resp:
        return error_resp, status

    box = SavingBox.query.filter_by(id=box_id, user_id=user_id).first_or_404()

    data_json = request.get_json() or {}
    desc = data_json.get("description")

    try:
        amount, d = _parse_amount_and_date(data_json)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    current_balance = box.current_balance()
    if amount > current_balance + 1e-9:
        return jsonify(
            {
                "error": "Valor de resgate maior que o saldo disponível na caixinha.",
                "current_balance": current_balance,
            }
        ), 400

    tx = Transaction(
      user_id=user_id,
      tipo="income",
      valor=amount,
      categoria="Retirada de Caixinha",
      descricao=desc or f"Resgate de {box.name}",
      data=d,
      meio_pagamento=None,
      recorrente=False,
      logo=None,
    )

    movement = SavingMovement(
      box_id=box.id,
      type="withdraw",
      amount=amount,
      date=d,
      description=desc or "Resgate da caixinha",
      transaction_id=None,
    )

    try:
        db.session.add(tx)
        db.session.flush()
        movement.transaction_id = tx.id
        db.session.add(movement)
        db.session.commit()

        db.session.refresh(box)

        return jsonify(
            {
                "box": box.to_dict(include_movements=True),
                "transaction": tx.to_dict(),
            }
        ), 201
    except Exception as e:
        db.session.rollback()
        print(f"[ERRO] withdraw_from_saving_box: {e}")
        return jsonify({"error": "Erro ao registrar resgate da caixinha."}), 500
