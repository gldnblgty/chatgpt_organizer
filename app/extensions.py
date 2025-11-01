from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# Initialized without app; will be bound in create_app
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[]  # We'll pass from app.config in init_app
)
