import io
import json

def test_register_key_invalid(client):
    resp = client.post("/api/register-key", json={"api_key":"not-valid"})
    assert resp.status_code == 400

def test_categorize_missing_file(client):
    # Use year mode to avoid needing API key
    data = {"organize_mode":"year"}
    resp = client.post("/api/categorize", data=data)
    assert resp.status_code == 400

def test_categorize_year_ok(client):
    sample_json = json.dumps([{"id":"1","title":"X","create_time":1704067200,"mapping":{}}]).encode("utf-8")
    data = {
        "organize_mode": "year",
        "file": (io.BytesIO(sample_json), "export.json")
    }
    resp = client.post("/api/categorize", data=data, content_type="multipart/form-data")
    assert resp.status_code == 200
    job_id = resp.json["job_id"]
    # Immediately check progress endpoint exists
    prog = client.get(f"/api/progress/{job_id}")
    assert prog.status_code == 200
