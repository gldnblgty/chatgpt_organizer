from app import create_app

if __name__ == "__main__":
    app = create_app()
    print("\n" + "="*70)
    print("🚀 ChatGPT Organizer Server")
    print("="*70)
    print(f"🌐 Server: http://localhost:5000")
    print(f"📊 Debug logging: ENABLED")
    print("="*70 + "\n")
    app.run(debug=True, port=5000)
