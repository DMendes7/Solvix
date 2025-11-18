import os
from flask import Flask
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

def create_app():
    # usa instance_relative_config para salvar o DB em /instance/solvix.db
    app = Flask(
        __name__,
        instance_relative_config=True,
        static_folder="static",
        template_folder="templates",
    )

    # garante a pasta instance/
    os.makedirs(app.instance_path, exist_ok=True)

    # ---- CONFIGURAÇÕES GERAIS ----
    # chave para usar sessão (login)
    # em produção, configure a variável de ambiente SECRET_KEY
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "troque-esta-chave-em-producao")

    # SQLite persistente em instance/solvix.db
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + os.path.join(
        app.instance_path,
        "solvix.db",
    )
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["JSON_SORT_KEYS"] = False

    db.init_app(app)

    # registra blueprints existentes
    from .routes import routes as routes_blueprint
    from .api import api as api_blueprint

    app.register_blueprint(routes_blueprint)                  # páginas
    app.register_blueprint(api_blueprint, url_prefix="/api")  # REST API

    # cria tabelas 1x ao subir a app
    with app.app_context():
        db.create_all()

    # permite logos externas https e data-uri
    @app.after_request
    def set_csp(resp):
        resp.headers["Content-Security-Policy"] = "img-src 'self' https: data:;"
        return resp

    return app
