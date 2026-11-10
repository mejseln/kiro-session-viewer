#!/bin/bash

# Kiro Session Viewer - Quick Start Script

echo "🤖 Kiro Session Viewer"
echo "====================="
echo ""

# Check if Flask is installed
if ! python3 -c "import flask" 2>/dev/null; then
    echo "❌ Flask is not installed."
    echo ""
    echo "Install it with:"
    echo "  pip install -r requirements.txt"
    echo ""
    exit 1
fi

# Check if sessions directory exists
SESSIONS_DIR="$HOME/.kiro/sessions"
if [ ! -d "$SESSIONS_DIR" ]; then
    echo "⚠️  Warning: Kiro sessions directory not found at $SESSIONS_DIR"
    echo ""
    echo "The application will start but won't find any sessions."
    echo ""
fi

# Count session files
SESSION_COUNT=$(find "$SESSIONS_DIR" -name "sess_*.jsonl" 2>/dev/null | wc -l)
echo "📁 Found $SESSION_COUNT session(s) in $SESSIONS_DIR"
echo ""

# Start the server
echo "🚀 Starting server on http://127.0.0.1:5000"
echo ""
echo "Press Ctrl+C to stop"
echo ""

cd "$(dirname "$0")"
python3 app.py
