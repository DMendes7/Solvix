from app import create_app, db
from app.models import Transaction # Importa o modelo para que o Flask-SQLAlchemy o conheça

# Cria o aplicativo Flask
app = create_app()

@app.before_request
def create_tables():
    """Cria as tabelas do banco de dados antes da primeira requisição."""
    db.create_all()

if __name__ == '__main__':
    # O app.run() deve ser executado no contexto da aplicação
    with app.app_context():
        # Garante que as tabelas existem.
        db.create_all() 
    app.run(debug=True)