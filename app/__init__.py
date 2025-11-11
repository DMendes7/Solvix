# app/__init__.py (Se você precisar criá-lo)
from flask import Flask
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

def create_app():
    app = Flask(__name__)
    # Configuração do banco de dados (SQLite)
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///solvix.db'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

    # Inicializa o SQLAlchemy com a app
    db.init_app(app)

    # Importa e registra as Blueprints
    from .routes import routes as routes_blueprint
    from .api import api as api_blueprint

    app.register_blueprint(routes_blueprint)
    app.register_blueprint(api_blueprint, url_prefix='/api')

    return app