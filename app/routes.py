from flask import Blueprint, render_template

# Define o Blueprint para as rotas de visualização (frontend)
routes = Blueprint('routes', __name__)

@routes.route('/')
def dashboard():
    """Rota principal que renderiza o dashboard."""
    # O arquivo dashboard.html já está na pasta app/templates/
    return render_template('dashboard.html')

# Se houver outras rotas de visualização, adicione-as aqui:
# @routes.route('/faturas')
# def faturas():
#     return render_template('faturas.html')