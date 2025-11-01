from flask import Flask, render_template
from flask_cors import CORS
from .config import Config
from .extensions import limiter

def create_app():
    app = Flask(__name__, static_folder="static", template_folder="templates")
    app.config.from_object(Config)

    # CORS
    CORS(app, origins=app.config.get("CORS_ORIGINS", "*"))

    # Rate limiting
    limiter.init_app(app)
    # Apply default from config if present
    default = app.config.get("RATELIMIT_DEFAULT", "10 per second")
    if default:
        limiter._default_limits = [default] if isinstance(default, str) else default

    # Register blueprints
    from .routes.api import api_bp
    app.register_blueprint(api_bp, url_prefix="/api")

    @app.route("/")
    def index():
        return render_template("index.html")

    return app
