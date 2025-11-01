import json
import tempfile
import uuid
from time import time
from secrets import token_urlsafe
from flask import Blueprint, request, jsonify
from cryptography.fernet import InvalidToken

from ..utils.keys import FERNET
from ..services.store import KEY_STORE, KEY_TTL_SECONDS, JOBS, is_token_expired
from ..services.jobs import process_job
from ..extensions import limiter

api_bp = Blueprint("api", __name__)

def resolve_api_key_from_token(tok: str) -> str | None:
    rec = KEY_STORE.get(tok)
    if not rec or is_token_expired(rec):
        KEY_STORE.pop(tok, None)
        return None
    try:
        return FERNET.decrypt(rec['enc_key']).decode()
    except InvalidToken:
        KEY_STORE.pop(tok, None)
        return None

@api_bp.route("/register-key", methods=["POST"])
@limiter.limit("5 per minute")
def register_key():
    try:
        data = request.get_json(silent=True) or {}
        api_key = data.get('api_key', '')
        if not (isinstance(api_key, str) and api_key.startswith('sk-')):
            return jsonify({'error': 'Invalid API key'}), 400
        tok = token_urlsafe(24)
        KEY_STORE[tok] = {
            'enc_key': FERNET.encrypt(api_key.encode()),
            'exp': int(time()) + KEY_TTL_SECONDS
        }
        return jsonify({'key_token': tok, 'ttl_seconds': KEY_TTL_SECONDS})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@api_bp.route("/categorize", methods=["POST"])
def categorize():
    try:
        organize_mode = request.form.get('organize_mode', 'category')
        if organize_mode not in ('category', 'month', 'year'):
            organize_mode = 'category'

        api_key = None
        if organize_mode == 'category':
            key_token = request.headers.get('X-Key-Token', '')
            if not key_token:
                return jsonify({'error': 'Missing key token. Register your key first.'}), 401
            api_key = resolve_api_key_from_token(key_token)
            if not api_key:
                return jsonify({'error': 'Key token invalid or expired. Please re-enter your key.'}), 401

        if 'file' not in request.files:
            return jsonify({'error': 'No file uploaded'}), 400
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as temp_file:
            content = file.read().decode('utf-8')
            temp_file.write(content)
            temp_path = temp_file.name

        custom_categories = request.form.get('categories')
        if custom_categories:
            try:
                custom_categories = json.loads(custom_categories)
            except Exception:
                custom_categories = None
        else:
            custom_categories = None

        try:
            batch_size = int(request.form.get('batch_size', 25))
        except Exception:
            batch_size = 25
        try:
            max_concurrency = int(request.form.get('max_concurrency', 4))
        except Exception:
            max_concurrency = 4

        batch_size = max(5, min(100, batch_size))
        max_concurrency = max(1, min(8, max_concurrency))

        job_id = str(uuid.uuid4())
        JOBS[job_id] = {
            'status': 'processing',
            'progress': 0,
            'processed': 0,
            'total': 1,
            'message': 'Queued',
            'result': None,
            'error': None
        }

        import threading
        t = threading.Thread(
            target=process_job,
            args=(job_id, api_key, temp_path, organize_mode, custom_categories, batch_size, max_concurrency),
            daemon=True
        )
        t.start()

        return jsonify({'job_id': job_id})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@api_bp.route("/progress/<job_id>", methods=["GET"])
def progress(job_id):
    job = JOBS.get(job_id)
    if not job:
        return jsonify({'error': 'Unknown job id'}), 404
    return jsonify({
        'status': job['status'],
        'progress': job['progress'],
        'processed': job['processed'],
        'total': job['total'],
        'message': job.get('message', '')
    })

@api_bp.route("/result/<job_id>", methods=["GET"])
def result(job_id):
    job = JOBS.get(job_id)
    if not job:
        return jsonify({'error': 'Unknown job id'}), 404
    if job['status'] == 'error':
        return jsonify({'error': job.get('error', 'Unknown error')}), 500
    if job['status'] != 'done':
        return jsonify({'error': 'Job not finished'}), 409
    return jsonify(job['result'])
