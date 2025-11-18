from app import create_app

# Cria o aplicativo Flask
app = create_app()

# Rodando localmente
if __name__ == "__main__":
    app.run(debug=True)
