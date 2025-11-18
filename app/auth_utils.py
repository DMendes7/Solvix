# app/auth_utils.py
import json
import os
import hashlib

# Caminho para o users.json dentro da pasta app
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
USERS_FILE = os.path.join(BASE_DIR, "users.json")


def load_users():
    """Carrega todos os usuários do users.json."""
    if not os.path.exists(USERS_FILE):
        return []
    with open(USERS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def find_user_by_username(username: str):
    """Retorna o dicionário do usuário dado um username, ou None se não achar."""
    users = load_users()
    for user in users:
        if user.get("username") == username:
            return user
    return None


def check_password(user, plain_password: str) -> bool:
    """Verifica se a senha em texto corresponde ao hash salvo no users.json."""
    if not user:
        return False

    password_hash = user.get("password_hash")
    if not password_hash:
        return False

    computed_hash = hashlib.sha256(plain_password.encode("utf-8")).hexdigest()
    return computed_hash == password_hash


def make_password_hash(plain_password: str) -> str:
    """Helper opcional para gerar hash de novas senhas."""
    return hashlib.sha256(plain_password.encode("utf-8")).hexdigest()
