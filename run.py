from app import create_app

app = create_app()

if __name__ == "__main__":
    # modo dev local
    app.run(debug=True)
