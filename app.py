import os
import uuid
import tempfile
import json
import math
import numpy as np
from flask import Flask, request, jsonify, Response, abort
from data_parser import parse_file
from detector import detect_mappings
from cleaner import clean_and_join_data
import analytics

# Set static_folder to None so Flask does not automatically expose everything under static/
# We will serve resources explicitly and block raw source viewing.
app = Flask(__name__, static_folder=None)
app.config['MAX_CONTENT_LENGTH'] = 200 * 1024 * 1024  # Allow up to 200MB uploads

# In-memory storage for session DataFrames
SESSION_CACHE = {}


def make_json_safe(obj):
    """Recursively make an object JSON-serializable — handles NaN, inf, numpy types."""
    if isinstance(obj, dict):
        return {k: make_json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [make_json_safe(v) for v in obj]
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        v = float(obj)
        return None if (math.isnan(v) or math.isinf(v)) else v
    if isinstance(obj, np.ndarray):
        return make_json_safe(obj.tolist())
    if isinstance(obj, np.bool_):
        return bool(obj)
    return obj


def json_response(data, status=200):
    """Return a Flask Response with NaN-safe JSON."""
    safe = make_json_safe(data)
    return Response(json.dumps(safe), status=status, mimetype='application/json')


# Secure routing for index.html (the single page application shell)
@app.route('/')
@app.route('/upload')
@app.route('/mapping')
@app.route('/dashboard')
def client_routes():
    """All page-navigation routes redirect to the root index.html to serve client SPA."""
    try:
        static_dir = os.path.join(app.root_path, 'static')
        return Response(open(os.path.join(static_dir, 'index.html'), 'rb').read(), mimetype='text/html')
    except Exception:
        abort(404)


# Serve assets strictly as resources (block source-code viewing / raw scripts navigation)
@app.route('/style.css')
def serve_css():
    try:
        static_dir = os.path.join(app.root_path, 'static')
        return Response(open(os.path.join(static_dir, 'style.css'), 'rb').read(), mimetype='text/css')
    except Exception:
        abort(404)


@app.route('/app.js')
def serve_js():
    # Only allow fetching JS from client-side script tag references (blocking direct navigations if needed,
    # or serving strictly with Javascript MIME to ensure it behaves purely as a resource)
    try:
        static_dir = os.path.join(app.root_path, 'static')
        return Response(open(os.path.join(static_dir, 'app.js'), 'rb').read(), mimetype='application/javascript')
    except Exception:
        abort(404)


# APIs
@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return json_response({'error': 'No file part in the request'}, 400)

    file = request.files['file']
    if file.filename == '':
        return json_response({'error': 'No selected file'}, 400)

    try:
        temp_dir = tempfile.gettempdir()
        _, ext = os.path.splitext(file.filename)
        temp_path = os.path.join(temp_dir, f"{uuid.uuid4()}{ext}")
        file.save(temp_path)

        dfs = parse_file(temp_path)

        try:
            os.remove(temp_path)
        except Exception:
            pass

        suggested_mappings = detect_mappings(dfs)

        all_columns = []
        for sheet, df in dfs.items():
            for col in df.columns:
                all_columns.append({
                    'sheet': sheet,
                    'column': col,
                    'label': f"{sheet} → {col}"
                })

        session_id = str(uuid.uuid4())
        SESSION_CACHE[session_id] = {
            'raw_dfs': dfs,
            'filename': file.filename
        }

        previews = {}
        for sheet, df in dfs.items():
            previews[sheet] = make_json_safe(
                json.loads(df.head(5).to_json(orient='records', default_handler=str))
            )

        return json_response({
            'session_id': session_id,
            'filename': file.filename,
            'sheets': list(dfs.keys()),
            'columns': all_columns,
            'suggested_mappings': suggested_mappings,
            'previews': previews
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return json_response({'error': str(e)}, 500)


@app.route('/api/confirm-mapping', methods=['POST'])
def confirm_mapping():
    data = request.json
    session_id = data.get('session_id')
    mappings = data.get('mappings')

    if not session_id or session_id not in SESSION_CACHE:
        return json_response({'error': 'Invalid or expired session'}, 400)

    session_item = SESSION_CACHE[session_id]
    raw_dfs = session_item.get('raw_dfs')

    try:
        df_parent, df_child, df_joined = clean_and_join_data(raw_dfs, mappings)

        session_item['df_parent'] = df_parent
        session_item['df_child'] = df_child
        session_item['df_joined'] = df_joined
        session_item['mappings'] = mappings

        return json_response({'status': 'success'})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return json_response({'error': f"Failed to clean/join data: {str(e)}"}, 500)


@app.route('/api/overview', methods=['GET'])
def get_overview():
    session_id = request.args.get('session_id')
    if not session_id or session_id not in SESSION_CACHE:
        return json_response({'error': 'Invalid or expired session'}, 400)

    session_item = SESSION_CACHE[session_id]
    df_parent = session_item.get('df_parent')
    mappings = session_item.get('mappings')

    stats = analytics.get_overview_stats(df_parent, mappings)
    return json_response(stats)


@app.route('/api/vendor-analysis', methods=['GET'])
def get_vendor_analysis():
    session_id = request.args.get('session_id')
    if not session_id or session_id not in SESSION_CACHE:
        return json_response({'error': 'Invalid or expired session'}, 400)

    session_item = SESSION_CACHE[session_id]
    df_parent = session_item.get('df_parent')
    mappings = session_item.get('mappings')

    result = analytics.get_vendor_analysis(df_parent, mappings)
    return json_response(result)


@app.route('/api/vendor-detail/<path:vendor_name>', methods=['GET'])
def get_vendor_detail(vendor_name):
    session_id = request.args.get('session_id')
    if not session_id or session_id not in SESSION_CACHE:
        return json_response({'error': 'Invalid or expired session'}, 400)

    session_item = SESSION_CACHE[session_id]
    df_parent = session_item.get('df_parent')
    df_joined = session_item.get('df_joined')
    mappings = session_item.get('mappings')

    detail = analytics.get_vendor_details(df_parent, df_joined, vendor_name, mappings)
    if not detail:
        return json_response({'error': 'Vendor not found'}, 404)

    return json_response(detail)


@app.route('/api/column-analysis', methods=['GET'])
def get_column_analysis():
    session_id = request.args.get('session_id')
    if not session_id or session_id not in SESSION_CACHE:
        return json_response({'error': 'Invalid or expired session'}, 400)

    session_item = SESSION_CACHE[session_id]
    df_child = session_item.get('df_child')
    df_joined = session_item.get('df_joined')
    mappings = session_item.get('mappings')

    result = analytics.get_column_analysis(df_joined, df_child, mappings)
    return json_response(result)


@app.route('/api/time-analysis', methods=['GET'])
def get_time_analysis():
    session_id = request.args.get('session_id')
    if not session_id or session_id not in SESSION_CACHE:
        return json_response({'error': 'Invalid or expired session'}, 400)

    try:
        segments = int(request.args.get('segments', 8))
    except ValueError:
        segments = 8

    reference_column = request.args.get('reference_column', 'start_time')

    session_item = SESSION_CACHE[session_id]
    df_parent = session_item.get('df_parent')
    mappings = session_item.get('mappings')

    result = analytics.get_time_analysis(df_parent, mappings, segments, reference_column)
    return json_response(result)



@app.route('/api/check-session', methods=['GET'])
def check_session():
    session_id = request.args.get('session_id')
    if session_id and session_id in SESSION_CACHE:
        session_item = SESSION_CACHE[session_id]
        return json_response({
            'active': True,
            'filename': session_item.get('filename'),
            'has_mappings': 'mappings' in session_item
        })
    return json_response({'active': False})


# Handle 404 error with a custom redirection to safety page or SPA root
@app.errorhandler(404)
def page_not_found(e):
    # Direct redirects on navigation fallback
    return Response("""
    <html>
      <head>
        <title>Page Not Found</title>
        <script>window.location.href = "/";</script>
      </head>
      <body>Redirecting...</body>
    </html>
    """, status=404, mimetype='text/html')


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)
