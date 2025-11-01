import json
import os
import tempfile
import threading
import uuid
import traceback
from datetime import datetime

from .chatgpt_categorizer import ChatGPTCategorizer
from .time_grouping import group_conversations_by_date
from .store import JOBS
from ..utils.keys import FERNET

def set_job_progress(job_id, processed, total, message="Processing..."):
    job = JOBS.get(job_id)
    if not job:
        return
    job['processed'] = int(processed)
    job['total'] = max(int(total), 1)
    pct = int(round((processed / job['total']) * 100))
    job['progress'] = max(0, min(100, pct))
    job['message'] = message
    print(f"[JOB {job_id}] Progress: {processed}/{total} ({pct}%) - {message}")

def finish_job(job_id, result=None, error=None):
    job = JOBS.get(job_id)
    if not job:
        return
    if error:
        job['status'] = 'error'
        job['error'] = str(error)
        job['message'] = 'Failed'
        print(f"[JOB {job_id}] FAILED: {error}")
    else:
        job['status'] = 'done'
        job['result'] = result
        job['progress'] = 100
        job['message'] = 'Completed'
        print(f"[JOB {job_id}] COMPLETED")

def process_job(job_id, api_key, temp_path, organize_mode, custom_categories, batch_size, max_concurrency):
    try:
        print(f"[JOB {job_id}] Starting job - Mode: {organize_mode}")
        with open(temp_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        conversations = data if isinstance(data, list) else [data]
        total = len(conversations)
        set_job_progress(job_id, 0, total, "Preparing…")

        if organize_mode in ("month", "year"):
            time_periods = group_conversations_by_date(conversations, mode=organize_mode)
            result = {
                "summary": {
                    "total_conversations": total,
                    "total_groups": len(time_periods),
                    "generated_at": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    "organize_mode": organize_mode
                },
                "time_periods": time_periods
            }
            set_job_progress(job_id, total, total, "Finalizing…")
            finish_job(job_id, result=result)
            return

        categorizer = ChatGPTCategorizer(api_key=api_key)

        def progress_cb(processed, total_hint):
            set_job_progress(job_id, processed, total or total_hint or 1, "Categorizing…")

        import inspect
        sig = inspect.signature(categorizer.process_export)
        params = sig.parameters
        kwargs = {'custom_categories': custom_categories, 'batch_size': batch_size}
        if 'max_concurrency' in params:
            kwargs['max_concurrency'] = max_concurrency
        if 'progress_cb' in params:
            kwargs['progress_cb'] = progress_cb

        categorized = categorizer.process_export(temp_path, **kwargs)
        result = {
            "summary": {
                "total_conversations": total,
                "total_categories": len(categorized),
                "generated_at": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                "organize_mode": organize_mode
            },
            "categories": categorized
        }
        set_job_progress(job_id, total, total, "Finalizing…")
        finish_job(job_id, result=result)
    except Exception as e:
        error_msg = f"{str(e)}\n{traceback.format_exc()}"
        print(f"[JOB {job_id}] ERROR: {error_msg}")
        finish_job(job_id, error=error_msg)
    finally:
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
                print(f"[JOB {job_id}] Cleaned up temp file")
        except Exception as e:
            print(f"[JOB {job_id}] Failed to clean temp file: {e}")
