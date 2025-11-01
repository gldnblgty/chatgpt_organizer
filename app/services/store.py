from time import time

# In-memory stores
KEY_STORE = {}  # token -> { enc_key: bytes, exp: int }
KEY_TTL_SECONDS = 600  # 10 minute

JOBS = {}       # job_id -> { status, progress, total, processed, message, result, error }

def is_token_expired(rec):
    return rec.get("exp", 0) < int(time())
