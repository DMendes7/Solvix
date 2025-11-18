import os
from flask import Flask
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

def create_app():
    app = Flask(
        __name__,
        instance_relative_config=True,
        static_folder="static",
        template_folder="templates",
    )

    # garante a pasta instance/ (útil se algum dia usar SQLite localmente)
    os.makedirs(app.instance_path, exist_ok=True)

    # 1) Tenta usar DATABASE_URL (Postgres na Render)
    db_url = os.getenv("DATABASE_URL")

    if db_url:
        # Render costuma fornecer 'postgres://', SQLAlchemy prefere 'postgresql://'
        if db_url.startswith("postgres://"):
            db_url = db_url.replace("postgres://", "postgresql://", 1)
    else:
        # 2) Fallback: SQLite local (para desenvolvimento na sua máquina)
        db_url = "sqlite:///" + os.path.join(app.instance_path, "solvix.db")

    app.config["SQLALCHEMY_DATABASE_URI"] = db_url
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["JSON_SORT_KEYS"] = False

    # chave de sessão (login)
    app.config["SECRET_KEY"] = os.environ.get(
        "SECRET_KEY",
        "dev-secret-change-this"
    )

    db.init_app(app)

    # registra blueprints
    from .routes import routes as routes_blueprint
    from .api import api as api_blueprint

    app.register_blueprint(routes_blueprint)
    app.register_blueprint(api_blueprint, url_prefix="/api")

    # cria tabelas uma vez no start
    with app.app_context():
        db.create_all()

    # CSP pra imagens externas
    @app.after_request
    def set_csp(resp):
        resp.headers["Content-Security-Policy"] = "img-src 'self' https: data:;"
        return resp

    return app
