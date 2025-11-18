from flask import (
    Blueprint,
    render_template,
    request,
    redirect,
    url_for,
    session,
    flash,
)
from functools import wraps

from .auth_utils import find_user_by_username, check_password

# Define o Blueprint para as rotas de visualização (frontend)
routes = Blueprint("routes", __name__)


def login_required(view_func):
    """
    Decorator simples para exigir que o usuário esteja logado
    antes de acessar determinadas rotas.
    """
    @wraps(view_func)
    def wrapped_view(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("routes.login"))
        return view_func(*args, **kwargs)

    return wrapped_view


@routes.route("/login", methods=["GET", "POST"])
def login():
    """
    Tela de login.
    Usa os usuários cadastrados em app/users.json.
    """
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        user = find_user_by_username(username)

        if not user or not check_password(user, password):
            flash("Usuário ou senha inválidos.", "danger")
            return render_template("login.html")

        # Guarda dados básicos na sessão
        session["user_id"] = user.get("id")
        session["username"] = user.get("username")
        session["name"] = user.get("name")

        return redirect(url_for("routes.dashboard"))

    # Se já estiver logado e acessar /login, redireciona pro dashboard
    if "user_id" in session:
        return redirect(url_for("routes.dashboard"))

    return render_template("login.html")


@routes.route("/logout")
def logout():
    """
    Sai da sessão atual e volta para a tela de login.
    """
    session.clear()
    return redirect(url_for("routes.login"))


@routes.route("/")
@login_required
def dashboard():
    """Rota principal que renderiza o dashboard."""
    # O arquivo dashboard.html já está na pasta app/templates/
    # Aqui podemos passar dados do usuário logado se o template quiser usar
    return render_template(
        "dashboard.html",
        username=session.get("username"),
        name=session.get("name"),
    )

# Se houver outras rotas de visualização, adicione-as aqui:
# @routes.route('/faturas')
# @login_required
# def faturas():
#     return render_template('faturas.html')
