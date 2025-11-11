from flask import Blueprint, request, jsonify
from . import db
from .models import Transaction
from datetime import datetime
import json

# Define o Blueprint para as rotas da API
api = Blueprint('api', __name__)

@api.route('/transactions', methods=['GET'])
def get_transactions():
    """Retorna todas as transações, ordenadas da mais recente para a mais antiga."""
    transactions = Transaction.query.order_by(Transaction.data.desc()).all()
    # Converte a lista de objetos Transaction para uma lista de dicionários (JSON)
    return jsonify([t.to_dict() for t in transactions])

@api.route('/transactions', methods=['POST'])
def add_transaction():
    """Adiciona uma nova transação."""
    data = request.get_json()

    if not data:
        return jsonify({"error": "Dados JSON ausentes ou mal formatados"}), 400

    # 1. Validação de Campos Obrigatórios
    required_fields = ['tipo', 'valor', 'categoria', 'data']
    for field in required_fields:
        if field not in data or not data[field]:
            return jsonify({"error": f"O campo '{field}' é obrigatório."}), 400

    # 2. Tratamento do Valor (CORREÇÃO DO float() argument must be...)
    valor_str = str(data.get('valor')).replace(',', '.')
    try:
        valor = float(valor_str)
        if valor <= 0:
            return jsonify({"error": "O valor deve ser positivo."}), 400
    except ValueError:
        return jsonify({"error": "O campo 'valor' deve ser um número válido."}), 400

    # 3. Tratamento da Data
    try:
        # Assumindo que a data vem no formato 'YYYY-MM-DD' do input HTML
        data_obj = datetime.strptime(data['data'], '%Y-%m-%d').date()
    except ValueError:
        return jsonify({"error": "Formato de data inválido. Use AAAA-MM-DD."}), 400
    
    # 4. Criação da Transação
    new_transaction = Transaction(
        tipo=data['tipo'],
        valor=valor,
        categoria=data['categoria'],
        descricao=data.get('descricao'), # O Flask-SQLAlchemy aceita None/vazio se nullable=True
        data=data_obj,
        meio_pagamento=data.get('meio_pagamento'),
        recorrente=data.get('recorrente', False),
        logo=data.get('logo')
    )

    try:
        db.session.add(new_transaction)
        db.session.commit()
        return jsonify(new_transaction.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        print(f"Erro ao salvar no banco: {e}")
        return jsonify({"error": "Erro interno ao salvar a transação."}), 500

@api.route('/transactions/<int:id>', methods=['DELETE'])
def delete_transaction(id):
    """Deleta uma transação pelo ID."""
    transaction = Transaction.query.get_or_404(id)
    
    try:
        db.session.delete(transaction)
        db.session.commit()
        return jsonify({"message": "Transação excluída com sucesso"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Erro ao excluir a transação."}), 500