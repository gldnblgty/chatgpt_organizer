import os
from cryptography.fernet import Fernet

DEFAULT_KEY_PATH = os.getenv("SERVER_ENC_KEY_PATH", os.path.join(os.getcwd(), "server_secret.key"))

def load_or_create_fernet_key() -> bytes:
    env_key = os.getenv("SERVER_ENC_KEY")
    if env_key:
        return env_key.encode() if isinstance(env_key, str) else env_key
    if os.path.exists(DEFAULT_KEY_PATH):
        with open(DEFAULT_KEY_PATH, "rb") as f:
            key = f.read().strip()
            if key:
                return key
    key = Fernet.generate_key()
    os.makedirs(os.path.dirname(DEFAULT_KEY_PATH) or ".", exist_ok=True)
    with open(DEFAULT_KEY_PATH, "wb") as f:
        f.write(key)
    try:
        os.chmod(DEFAULT_KEY_PATH, 0o600)
    except Exception:
        pass
    return key

FERNET = Fernet(load_or_create_fernet_key())
