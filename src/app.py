"""
Kiro Session Viewer - Flask Backend
Reads and serves Kiro session data from ~/.kiro/sessions
"""

import os
import json
from pathlib import Path
from datetime import datetime
from flask import Flask, render_template, jsonify, send_from_directory, request
from session_organizer import SessionOrganizer

app = Flask(__name__)

# Path to Kiro sessions directory
SESSIONS_DIR = Path.home() / ".kiro" / "sessions"

# Path to organizer data file
ORGANIZER_DATA_FILE = Path.home() / ".kiro" / "session_viewer_data.json"

# Initialize organizer
organizer = SessionOrganizer(ORGANIZER_DATA_FILE)


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
        # First, try to read title from session.json
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


@app.route('/api/folders')
def get_folders():
    """API endpoint to get folder structure."""
    folder_id = request.args.get('folder_id')  # None for root
    
    contents = organizer.get_folder_contents(folder_id)
    
    # Get folder path if not root
    path = []
    if folder_id:
        path = organizer.get_folder_path(folder_id)
    
    # If at root level, show all unorganized sessions plus explicitly root sessions
    if folder_id is None:
        # Get all session files
        session_files = get_session_files()
        all_session_ids = [session_file.parent.name for session_file in session_files]
        
        # Get sessions that are explicitly in existing folders (not root)
        sessions_in_folders = set()
        existing_folders = set(organizer.data.get('folders', {}).keys())
        
        for session_id, session_data in organizer.data.get('sessions', {}).items():
            folder = session_data.get('folder_id')
            # Only count as "in folder" if the folder actually exists
            if folder is not None and folder != '' and folder in existing_folders:
                sessions_in_folders.add(session_id)
        
        # Sessions at root = all sessions minus those in existing folders
        root_sessions = [sid for sid in all_session_ids if sid not in sessions_in_folders]
        
        contents['sessions'] = root_sessions
    
    return jsonify({
        'folder_id': folder_id,
        'path': path,
        'folders': contents['folders'],
        'session_ids': contents['sessions']
    })


@app.route('/api/folder/create', methods=['POST'])
def create_folder():
    """API endpoint to create a new folder."""
    data = request.json
    name = data.get('name', 'New Folder')
    parent_id = data.get('parent_id')
    
    folder_id = organizer.create_folder(name, parent_id)
    
    return jsonify({'folder_id': folder_id, 'name': name})


@app.route('/api/folder/rename', methods=['POST'])
def rename_folder():
    """API endpoint to rename a folder."""
    data = request.json
    folder_id = data.get('folder_id')
    new_name = data.get('name')
    
    print(f"Rename folder request: folder_id={folder_id}, name={new_name}")
    
    if not folder_id or not new_name:
        return jsonify({'error': 'Missing folder_id or name'}), 400
    
    try:
        organizer.rename_folder(folder_id, new_name)
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error renaming folder: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/folder/delete', methods=['POST'])
def delete_folder():
    """API endpoint to delete a folder."""
    data = request.json
    folder_id = data.get('folder_id')
    
    if not folder_id:
        return jsonify({'error': 'Missing folder_id'}), 400
    
    organizer.delete_folder(folder_id)
    
    return jsonify({'success': True})


@app.route('/api/folder/move', methods=['POST'])
def move_folder():
    """API endpoint to move a folder to another folder or root."""
    data = request.json
    folder_id = data.get('folder_id')
    parent_id = data.get('parent_id')  # None for root
    
    if not folder_id:
        return jsonify({'error': 'Missing folder_id'}), 400
    
    try:
        organizer.move_folder(folder_id, parent_id)
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error moving folder: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/session/rename', methods=['POST'])
def rename_session():
    """API endpoint to rename a session."""
    data = request.json
    session_id = data.get('session_id')
    new_name = data.get('name')
    
    print(f"Rename session request: session_id={session_id}, name={new_name}")
    
    if not session_id or not new_name:
        return jsonify({'error': 'Missing session_id or name'}), 400
    
    try:
        organizer.set_session_name(session_id, new_name)
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error renaming session: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/session/reset-name', methods=['POST'])
def reset_session_name():
    """API endpoint to reset a session name to default."""
    data = request.json
    session_id = data.get('session_id')
    
    print(f"Reset session name request: session_id={session_id}")
    
    if not session_id:
        return jsonify({'error': 'Missing session_id'}), 400
    
    try:
        # Remove custom name by deleting it from the sessions dict
        if session_id in organizer.data['sessions']:
            if 'custom_name' in organizer.data['sessions'][session_id]:
                del organizer.data['sessions'][session_id]['custom_name']
                organizer._save_data()
        
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error resetting session name: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/cleanup', methods=['POST'])
def cleanup_orphaned_sessions():
    """Clean up sessions that reference non-existent folders."""
    try:
        existing_folders = set(organizer.data.get('folders', {}).keys())
        fixed_count = 0
        
        for session_id, session_data in organizer.data.get('sessions', {}).items():
            folder_id = session_data.get('folder_id')
            
            # If session references a folder that doesn't exist, set to None
            if folder_id and folder_id not in existing_folders:
                session_data['folder_id'] = None
                fixed_count += 1
        
        if fixed_count > 0:
            organizer._save_data()
        
        return jsonify({'success': True, 'fixed': fixed_count})
    except Exception as e:
        print(f"Error cleaning up: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/session/move', methods=['POST'])
def move_session():
    """API endpoint to move a session to a folder."""
    data = request.json
    session_id = data.get('session_id')
    folder_id = data.get('folder_id')  # None for root
    
    if not session_id:
        return jsonify({'error': 'Missing session_id'}), 400
    
    organizer.move_session_to_folder(session_id, folder_id)
    
    return jsonify({'success': True})


@app.route('/api/search')
def search_sessions():
    """API endpoint to search across all sessions."""
    query = request.args.get('q', '').strip()
    folder_id = request.args.get('folder_id')  # Optional folder filter
    
    if not query or len(query) < 2:
        return jsonify({"error": "Query must be at least 2 characters"}), 400
    
    # Get session IDs to search
    if folder_id and folder_id != 'root':
        # Search only in specified folder and subfolders
        session_ids_to_search = set(organizer.get_sessions_in_folder_recursive(folder_id))
    elif folder_id == 'root':
        # Search only root-level sessions
        contents = organizer.get_folder_contents(None)
        session_ids_to_search = set(contents['sessions'])
    else:
        # Search all sessions
        session_ids_to_search = None
    
    results = []
    session_files = get_session_files()
    
    # Search through each session
    for session_file in session_files:
        try:
            session_id = session_file.parent.name
            
            # Skip if not in the filtered set
            if session_ids_to_search is not None and session_id not in session_ids_to_search:
                continue
            
            with open(session_file, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            # Get session metadata
            metadata = parse_session_metadata(session_file)
            if not metadata:
                continue
            
            # Search through messages
            message_index = 0
            user_count = 0
            assistant_count = 0
            
            for line_num, line in enumerate(lines):
                if not line.strip():
                    continue
                
                try:
                    msg = json.loads(line)
                    payload = msg.get('payload', {})
                    msg_type = payload.get('type')
                    content = payload.get('content', '')
                    
                    # Track message indices for user and assistant
                    if msg_type == 'user':
                        user_count += 1
                        message_index = user_count + assistant_count - 1
                    elif msg_type == 'assistant':
                        assistant_count += 1
                        message_index = user_count + assistant_count - 1
                    
                    # Search in content (case-insensitive)
                    if msg_type in ['user', 'assistant'] and isinstance(content, str):
                        lower_content = content.lower()
                        lower_query = query.lower()
                        
                        if lower_query in lower_content:
                            # Find the match position and extract context
                            match_pos = lower_content.find(lower_query)
                            
                            # Extract context (100 chars before and after)
                            start = max(0, match_pos - 100)
                            end = min(len(content), match_pos + len(query) + 100)
                            context = content[start:end]
                            
                            # Add ellipsis if truncated
                            if start > 0:
                                context = '...' + context
                            if end < len(content):
                                context = context + '...'
                            
                            # Get custom name
                            custom_name = organizer.get_session_name(session_id, metadata['title'])
                            
                            results.append({
                                "session_id": session_id,
                                "session_title": custom_name,
                                "session_date": metadata['timestamp'],
                                "message_index": message_index,
                                "message_type": msg_type,
                                "match_context": context,
                                "query": query
                            })
                            
                            # Limit to 3 matches per session to avoid overwhelming results
                            if len([r for r in results if r['session_id'] == session_id]) >= 3:
                                break
                
                except json.JSONDecodeError:
                    continue
        
        except Exception as e:
            print(f"Error searching {session_file}: {e}")
            continue
    
    # Sort by most recent first
    results.sort(key=lambda x: x['session_date'], reverse=True)
    
    # Limit total results
    results = results[:50]
    
    return jsonify({
        "query": query,
        "results": results,
        "total": len(results)
    })


@app.route('/api/sessions')
def get_sessions():
    """API endpoint to list all sessions with metadata."""
    folder_id = request.args.get('folder_id')  # Optional folder filter
    
    session_files = get_session_files()
    sessions = []
    
    for session_file in session_files:
        metadata = parse_session_metadata(session_file)
        if metadata:
            # Add custom name and folder info
            custom_name = organizer.get_session_name(metadata['id'], metadata['title'])
            folder = organizer.get_session_folder(metadata['id'])
            
            metadata['custom_name'] = custom_name
            metadata['folder_id'] = folder
            
            sessions.append(metadata)
    
    # Sort by timestamp (most recent first)
    sessions.sort(key=lambda x: x['timestamp'], reverse=True)
    
    # Filter by folder if specified
    if folder_id:
        if folder_id == 'root':
            # Only root-level sessions
            sessions = [s for s in sessions if not s['folder_id']]
        else:
            # Sessions in specific folder (not recursive)
            sessions = [s for s in sessions if s['folder_id'] == folder_id]
    
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
