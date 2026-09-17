"""
app.py
SIH26189 — Criminal Network Analysis
Flask REST API server.

Endpoints:
  GET  /api/health                  → health check
  GET  /api/datasets                → list available mock datasets
  POST /api/upload                  → upload CSV, get graph JSON
  POST /api/load-demo               → load a mock dataset by name
  POST /api/analyze/cluster         → AI crime analysis for a cluster
  POST /api/analyze/edge            → AI explanation for an edge
  POST /api/analyze/anomalies       → AI anomaly detection for whole graph
  POST /api/analyze/risk            → heuristic risk score for a person
"""

import os
import sys
import json
import glob
import traceback

# Ensure backend/ modules (graph_engine, ai_engine) are importable on Vercel
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, request, jsonify
from flask_cors import CORS

from graph_engine import build_graph_from_csv, build_combined_graph
from ai_engine import (
    guess_crime_pattern,
    explain_edge,
    detect_anomalies,
    score_person_risk,
    generate_case_summary,
)

# ─── App setup ─────────────────────────────────────────────────────────────────

app = Flask(__name__)
CORS(app, origins="*")

# Folder where the mock CSVs live
BASE_DIR   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR   = os.path.join(BASE_DIR, 'mock_data')

MOCK_DATASETS = {
    'call_records':               'Call_Records.csv',
    'bank_accounts':              'delhi_bank_accounts.csv',
    'bank_transactions':          'delhi_bank_transactions.csv',
    'vehicle_registrations':      'delhi_vehicle_registrations.csv',
    'vehicle_ownership_transfers':'delhi_vehicle_ownership_transfers.csv',
}


# ─── Helpers ───────────────────────────────────────────────────────────────────

def _error(msg: str, code: int = 400):
    return jsonify({'error': msg}), code

def _ok(data: dict):
    return jsonify({'status': 'ok', **data})


# ─── Routes ────────────────────────────────────────────────────────────────────

@app.route('/api/health', methods=['GET'])
def health():
    return _ok({'message': 'SIH26189 backend is running'})


@app.route('/api/datasets', methods=['GET'])
def list_datasets():
    """Return available mock datasets with metadata."""
    result = []
    for key, filename in MOCK_DATASETS.items():
        path = os.path.join(DATA_DIR, filename)
        exists = os.path.exists(path)
        size   = os.path.getsize(path) if exists else 0
        result.append({
            'key':      key,
            'filename': filename,
            'label':    key.replace('_', ' ').title(),
            'exists':   exists,
            'size_kb':  round(size / 1024, 1),
        })
    return _ok({'datasets': result})


@app.route('/api/load-all-demos', methods=['POST'])
def load_all_demos():
    """
    Load ALL mock datasets together into one combined graph.
    Body: { "suspected_only": false, "amount_threshold": 0 }
    """
    body = request.get_json(force=True, silent=True) or {}
    suspected_only   = bool(body.get('suspected_only', False))
    threshold        = float(body.get('amount_threshold', 0))

    file_dict = {}
    for key, filename in MOCK_DATASETS.items():
        path = os.path.join(DATA_DIR, filename)
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                file_dict[key] = f.read()

    try:
        graph = build_combined_graph(file_dict, threshold, suspected_only)
        return _ok({'graph': graph, 'filename': 'All Datasets Combined'})
    except Exception as e:
        traceback.print_exc()
        return _error(str(e), 500)


@app.route('/api/load-demo', methods=['POST'])
def load_demo():
    """
    Load a mock dataset from disk.
    Body: { "dataset": "bank_accounts", "amount_threshold": 0 }
    """
    body = request.get_json(force=True, silent=True) or {}
    key  = body.get('dataset', '')
    threshold = float(body.get('amount_threshold', 0))

    if key not in MOCK_DATASETS:
        return _error(f"Unknown dataset key: {key}. Valid keys: {list(MOCK_DATASETS)}")

    path = os.path.join(DATA_DIR, MOCK_DATASETS[key])
    if not os.path.exists(path):
        return _error(f"File not found: {path}", 404)

    try:
        with open(path, 'r', encoding='utf-8') as f:
            csv_text = f.read()
        graph = build_graph_from_csv(csv_text, MOCK_DATASETS[key], threshold)
        return _ok({'graph': graph, 'filename': MOCK_DATASETS[key]})
    except Exception as e:
        traceback.print_exc()
        return _error(str(e), 500)


@app.route('/api/upload', methods=['POST'])
def upload_csv():
    """
    Accept a file upload and return the graph.
    Supports CSV, JSON, XLS, XLSX, TXT.
    Multipart form: file=<file>, amount_threshold=<float> (optional)
    """
    if 'file' not in request.files:
        return _error("No file provided. Send field name 'file'.")

    f          = request.files['file']
    threshold  = float(request.form.get('amount_threshold', 0))
    filename   = f.filename or 'upload.csv'
    ext        = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''

    SUPPORTED = {'csv', 'json', 'xls', 'xlsx', 'txt'}
    if ext not in SUPPORTED:
        return _error(f"Unsupported file type '.{ext}'. Supported: CSV, JSON, XLS, XLSX, TXT. Convert data to CSV for best results.")

    try:
        raw_bytes = f.read()
        # For now, attempt UTF-8 decode (CSV path). Non-CSV types inform the user.
        if ext in ('xls', 'xlsx'):
            return _error("XLS/XLSX: Please export as CSV first, then re-upload.")
        if ext == 'json':
            return _error("JSON upload: Please convert to CSV format first, then re-upload.")
        csv_text = raw_bytes.decode('utf-8', errors='replace')
        graph = build_graph_from_csv(csv_text, filename, threshold)
        return _ok({'graph': graph, 'filename': filename})
    except Exception as e:
        traceback.print_exc()
        return _error(str(e), 500)


@app.route('/api/analyze/cluster', methods=['POST'])
def analyze_cluster():
    """
    AI crime analysis for a cluster.
    Body: {
      "cluster_members": ["Name1", "Name2", ...],
      "edges": [{source, target, type, description}, ...],
      "person_details": [{name, is_criminal, degree, ...}, ...]
    }
    """
    body = request.get_json(force=True, silent=True) or {}
    members = body.get('cluster_members', [])
    edges   = body.get('edges', [])
    details = body.get('person_details', [])

    if not members:
        return _error("cluster_members is required")

    try:
        result = guess_crime_pattern(members, edges, details)
        return _ok({'analysis': result})
    except Exception as e:
        traceback.print_exc()
        return _error(str(e), 500)


@app.route('/api/analyze/edge', methods=['POST'])
def analyze_edge():
    """
    AI explanation for a specific edge.
    Body: {
      "person_a": "Name A",
      "person_b": "Name B",
      "edge_types": ["phone call", ...],
      "descriptions": ["Called 9876543210", ...],
      "details_a": {...},
      "details_b": {...}
    }
    """
    body = request.get_json(force=True, silent=True) or {}
    a     = body.get('person_a', '')
    b     = body.get('person_b', '')
    types = body.get('edge_types', [])
    descs = body.get('descriptions', [])
    da    = body.get('details_a', {})
    db    = body.get('details_b', {})

    if not a or not b:
        return _error("person_a and person_b are required")

    try:
        explanation = explain_edge(a, b, types, descs, da, db)
        return _ok({'explanation': explanation})
    except Exception as e:
        traceback.print_exc()
        return _error(str(e), 500)


@app.route('/api/analyze/anomalies', methods=['POST'])
def analyze_anomalies():
    """
    AI anomaly detection across the whole graph.
    Body: { "stats": {...}, "nodes": [...], "edges": [...] }
    """
    body  = request.get_json(force=True, silent=True) or {}
    stats = body.get('stats', {})
    nodes = body.get('nodes', [])
    edges = body.get('edges', [])

    try:
        report = detect_anomalies(stats, nodes, edges)
        return _ok({'anomaly_report': report})
    except Exception as e:
        traceback.print_exc()
        return _error(str(e), 500)


@app.route('/api/analyze/risk', methods=['POST'])
def analyze_risk():
    """
    Heuristic risk score for a person (no AI call, instant).
    Body: { "person": {...node dict...}, "edges": [...edges connected to this node...] }
    """
    body   = request.get_json(force=True, silent=True) or {}
    person = body.get('person', {})
    edges  = body.get('edges', [])

    if not person:
        return _error("person is required")

    try:
        risk = score_person_risk(person, edges)
        return _ok({'risk': risk})
    except Exception as e:
        traceback.print_exc()
        return _error(str(e), 500)


@app.route('/api/analyze/summary', methods=['POST'])
def analyze_summary():
    """
    Generate a full case summary narrative for the loaded graph.
    Body: { "nodes": [...], "edges": [...], "clusters": [...], "stats": {...} }
    """
    body     = request.get_json(force=True, silent=True) or {}
    nodes    = body.get('nodes', [])
    edges    = body.get('edges', [])
    clusters = body.get('clusters', [])
    stats    = body.get('stats', {})

    if not nodes:
        return _error("nodes is required")

    try:
        summary = generate_case_summary(nodes, edges, clusters, stats)
        return _ok({'summary': summary})
    except Exception as e:
        traceback.print_exc()
        return _error(str(e), 500)


# ─── Entry point ───────────────────────────────────────────────────────────────

if __name__ == '__main__':
    print("=" * 60)
    print("  SIH26189 — Criminal Network Analysis Backend")
    print("  http://localhost:5000")
    print("=" * 60)
    app.run(debug=True, host='0.0.0.0', port=5000)
