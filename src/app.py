"""
Kiro Session Viewer - Flask Backend
Reads and serves Kiro session data from ~/.kiro/sessions
"""

import os
import json
from pathlib import Path
from datetime import datetime
from flask import Flask, render_template, jsonify, send_from_directory

app = Flask(__name__)

# Path to Kiro sessions directory
SESSIONS_DIR = Path.home() / ".kiro" / "sessions"


def get_session_files():
    """Get all session JSONL files from the sessions directory."""
    if not SESSIONS_DIR.exists():
        return []
    
    # Sessions are stored in subdirectories: <machine-id>/sess_<session-id>/messages.jsonl
    session_files = []
    
    # Look for all messages.jsonl files in sess_* directories
    for machine_dir in SESSIONS_DIR.iterdir():
        if machine_dir.is_dir() and not machine_dir.name.startswith('.'):
            for session_dir in machine_dir.iterdir():
                if session_dir.is_dir() and session_dir.name.startswith('sess_'):
                    messages_file = session_dir / 'messages.jsonl'
                    if messages_file.exists():
                        session_files.append(messages_file)
    
    return session_files


def parse_session_metadata(session_file):
    """Parse session file to extract metadata (title, timestamp, message count)."""
    try:
        # Read title from session.json
        session_json_file = session_file.parent / 'session.json'
        title = "Untitled Session"
        
        if session_json_file.exists():
            try:
                with open(session_json_file, 'r', encoding='utf-8') as f:
                    session_data = json.load(f)
                    title = session_data.get('title', 'Untitled Session')
            except Exception as e:
                print(f"Error reading session.json: {e}")
        
        # Read messages for counts and timestamp
        with open(session_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        messages = []
        timestamp = None
        
        for line in lines:
            if line.strip():
                try:
                    msg = json.loads(line)
                    
                    # Messages are nested in payload
                    payload = msg.get('payload', {})
                    msg_type = payload.get('type')
                    
                    # Get timestamp from first message
                    if timestamp is None and 'timestamp' in msg:
                        timestamp = msg['timestamp']
                    
                    # Count user and assistant messages
                    if msg_type in ['user', 'assistant']:
                        messages.append({'type': msg_type})
                
                except json.JSONDecodeError:
                    continue
        
        # Use file modification time if no timestamp found
        if timestamp is None:
            timestamp = datetime.fromtimestamp(session_file.stat().st_mtime).isoformat()
        
        # Extract session ID from parent directory name (sess_<id>)
        session_id = session_file.parent.name
        
        # Calculate grouped message count (consecutive assistant messages count as 1)
        grouped_count = 0
        last_type = None
        for msg in messages:
            if msg['type'] == 'user':
                grouped_count += 1
                last_type = 'user'
            elif msg['type'] == 'assistant' and last_type != 'assistant':
                grouped_count += 1
                last_type = 'assistant'
        
        return {
            "id": session_id,
            "title": title,
            "timestamp": timestamp,
            "message_count": len(messages),
            "grouped_message_count": grouped_count
        }
    
    except Exception as e:
        print(f"Error parsing {session_file}: {e}")
        return None


def parse_session_messages(session_file):
    """Parse all messages from a session file."""
    try:
        with open(session_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        messages = []
        
        for line in lines:
            if line.strip():
                try:
                    msg = json.loads(line)
                    
                    # Messages are nested in payload
                    payload = msg.get('payload', {})
                    msg_type = payload.get('type')
                    
                    # Only include user and assistant messages
                    if msg_type in ['user', 'assistant']:
                        messages.append({
                            "type": msg_type,
                            "content": payload.get('content', ''),
                            "timestamp": msg.get('timestamp', '')
                        })
                
                except json.JSONDecodeError:
                    continue
        
        return messages
    
    except Exception as e:
        print(f"Error reading {session_file}: {e}")
        return []


@app.route('/')
def index():
    """Serve the main HTML page."""
    return render_template('index.html')


@app.route('/api/sessions')
def get_sessions():
    """API endpoint to list all sessions with metadata."""
    session_files = get_session_files()
    sessions = []
    
    for session_file in session_files:
        metadata = parse_session_metadata(session_file)
        if metadata:
            sessions.append(metadata)
    
    # Sort by timestamp (most recent first)
    sessions.sort(key=lambda x: x['timestamp'], reverse=True)
    
    return jsonify(sessions)


@app.route('/api/session/<session_id>')
def get_session(session_id):
    """API endpoint to get full session messages."""
    # Find the session file by searching through machine directories
    session_file = None
    
    for machine_dir in SESSIONS_DIR.iterdir():
        if machine_dir.is_dir() and not machine_dir.name.startswith('.'):
            session_dir = machine_dir / session_id
            if session_dir.exists():
                messages_file = session_dir / 'messages.jsonl'
                if messages_file.exists():
                    session_file = messages_file
                    break
    
    if session_file is None:
        return jsonify({"error": "Session not found"}), 404
    
    messages = parse_session_messages(session_file)
    
    return jsonify({
        "id": session_id,
        "messages": messages
    })


@app.route('/static/<path:path>')
def send_static(path):
    """Serve static files."""
    return send_from_directory('static', path)


if __name__ == '__main__':
    print(f"Looking for sessions in: {SESSIONS_DIR}")
    print(f"Starting Kiro Session Viewer on http://127.0.0.1:5000")
    app.run(debug=True, port=5000)
