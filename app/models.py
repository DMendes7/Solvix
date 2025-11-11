from . import db
from datetime import datetime

class Transaction(db.Model):
    __tablename__ = 'transaction'
    id = db.Column(db.Integer, primary_key=True)
    
    # Campos obrigatórios
    tipo = db.Column(db.String(10), nullable=False) # 'income' ou 'expense'
    valor = db.Column(db.Float, nullable=False)
    categoria = db.Column(db.String(50), nullable=False)
    data = db.Column(db.Date, nullable=False, default=datetime.utcnow)

    # Campos opcionais/secundários
    descricao = db.Column(db.String(100), nullable=True) # Agora Opcional no front e no DB
    meio_pagamento = db.Column(db.String(20), nullable=True) # 'credit' ou 'debit'
    recorrente = db.Column(db.Boolean, default=False)
    logo = db.Column(db.String(250), nullable=True)
    
    # Campo para ordenação
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'tipo': self.tipo,
            'valor': self.valor,
            'categoria': self.categoria,
            'descricao': self.descricao,
            'data': self.data.isoformat() if self.data else None,
            'meio_pagamento': self.meio_pagamento,
            'recorrente': self.recorrente,
            'logo': self.logo
        }