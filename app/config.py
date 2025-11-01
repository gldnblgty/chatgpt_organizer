import os

class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret")
    # Flask-Limiter
    RATELIMIT_DEFAULT = os.getenv("RATELIMIT_DEFAULT", "10 per second")
    RATELIMIT_STORAGE_URI = os.getenv("RATELIMIT_STORAGE_URI", "memory://")
    # CORS
    CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*")
    # Server
    HOST = os.getenv("HOST", "0.0.0.0")
    PORT = int(os.getenv("PORT", "5000"))
