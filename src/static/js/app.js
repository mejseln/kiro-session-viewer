/**
 * Kiro Session Viewer - Frontend JavaScript
 * Handles session loading, rendering, and UI interactions
 */

// State
let sessions = [];
let currentSessionId = null;
let groupMessages = false; // Setting for grouping messages
let renameTarget = null; // For rename modal

// DOM Elements
const sessionList = document.getElementById('session-list');
const sessionCount = document.getElementById('session-count');
const welcomeMessage = document.getElementById('welcome-message');
const sessionContent = document.getElementById('session-content');
const sessionTitle = document.getElementById('session-title');
const sessionInfo = document.getElementById('session-info');
const messagesContainer = document.getElementById('messages-container');

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    // Load settings first
    loadSettings();
    
    // Load sessions metadata
    await loadSessions();
    
    // Load root folder view
    if (typeof loadFolder === 'function') {
        await loadFolder(null);
    }
    
    // Close modal when clicking outside
    document.getElementById('settings-modal').addEventListener('click', (e) => {
        if (e.target.id === 'settings-modal') {
            closeSettings();
        }
    });
    
    document.getElementById('search-modal').addEventListener('click', (e) => {
        if (e.target.id === 'search-modal') {
            closeSearch();
        }
    });
    
    document.getElementById('rename-modal').addEventListener('click', (e) => {
        if (e.target.id === 'rename-modal') {
            closeRenameModal();
        }
    });
});

/**
 * Load all sessions from the API (metadata only, no rendering)
 */
async function loadSessions() {
    try {
        // Load all sessions (not filtered by folder for global search)
        const response = await fetch('/api/sessions');
        sessions = await response.json();
    } catch (error) {
        console.error('Error loading sessions:', error);
        throw error;
    }
}

/**
 * Render the session list in the sidebar
 */
function renderSessionList() {
    if (sessions.length === 0) {
        sessionList.innerHTML = '<div class="loading">No sessions found</div>';
        sessionCount.textContent = '0';
        return;
    }

    sessionCount.textContent = sessions.length;

    sessionList.innerHTML = sessions.map(session => {
        // Calculate message count based on grouping setting
        const messageCount = groupMessages ? session.grouped_message_count : session.message_count;
        
        return `
            <div class="session-item" data-session-id="${session.id}" onclick="loadSession('${session.id}')">
                <div class="session-item-title">${escapeHtml(session.title)}</div>
                <div class="session-item-meta">
                    <span class="session-item-date">${formatDate(session.timestamp)}</span>
                    <span class="session-item-count">${messageCount} messages</span>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Calculate grouped message count for a session
 */
function calculateGroupedCount(messages) {
    if (!messages || messages.length === 0) return 0;
    
    let count = 0;
    let lastType = null;
    
    for (const message of messages) {
        if (message.type === 'user') {
            count++;
            lastType = 'user';
        } else if (message.type === 'assistant' && lastType !== 'assistant') {
            count++;
            lastType = 'assistant';
        }
    }
    
    return count;
}

/**
 * Load and display a specific session
 */
async function loadSession(sessionId) {
    if (currentSessionId === sessionId) return;

    try {
        currentSessionId = sessionId;

        // Update active state in sidebar
        document.querySelectorAll('.session-item').forEach(item => {
            item.classList.toggle('active', item.dataset.sessionId === sessionId);
        });

        // Show loading state
        messagesContainer.innerHTML = '<div class="loading">Loading messages...</div>';
        welcomeMessage.style.display = 'none';
        sessionContent.classList.remove('hidden');

        // Fetch session data
        const response = await fetch(`/api/session/${sessionId}`);
        const data = await response.json();

        // Find session metadata
        const session = sessions.find(s => s.id === sessionId);

        // Calculate correct message count based on grouping setting
        const displayCount = groupMessages 
            ? (session ? session.grouped_message_count : calculateGroupedCount(data.messages))
            : data.messages.length;

        // Update header
        sessionTitle.textContent = session ? session.title : 'Session';
        sessionInfo.textContent = session 
            ? `${formatDate(session.timestamp)} • ${displayCount} messages`
            : `${displayCount} messages`;

        // Render messages
        renderMessages(data.messages);

        // Scroll to bottom
        setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 100);

    } catch (error) {
        console.error('Error loading session:', error);
        messagesContainer.innerHTML = '<div class="loading">Error loading session</div>';
    }
}

/**
 * Render messages in the content area
 */
function renderMessages(messages) {
    if (messages.length === 0) {
        messagesContainer.innerHTML = '<div class="loading">No messages in this session</div>';
        return;
    }

    let messagesToRender = messages;
    
    // Group messages if setting is enabled
    if (groupMessages) {
        messagesToRender = groupAssistantMessages(messages);
    }

    messagesContainer.innerHTML = messagesToRender.map(message => {
        const avatar = message.type === 'user' ? '👤' : '🤖';
        const role = message.type === 'user' ? 'User' : 'Assistant';
        
        return `
            <div class="message ${message.type}">
                <div class="message-avatar">${avatar}</div>
                <div class="message-content">
                    <div class="message-header">
                        <span class="message-role">${role}</span>
                        ${message.timestamp ? `<span class="message-timestamp">${formatTimestamp(message.timestamp)}</span>` : ''}
                    </div>
                    <div class="message-body">
                        ${renderMessageContent(message.content)}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Group consecutive assistant messages into a single message
 */
function groupAssistantMessages(messages) {
    const grouped = [];
    let currentGroup = null;
    
    for (const message of messages) {
        if (message.type === 'user') {
            // User message always starts a new group
            if (currentGroup) {
                grouped.push(currentGroup);
                currentGroup = null;
            }
            grouped.push(message);
        } else if (message.type === 'assistant') {
            if (!currentGroup) {
                // Start a new assistant group
                currentGroup = {
                    type: 'assistant',
                    content: message.content,
                    timestamp: message.timestamp
                };
            } else {
                // Append to existing group with a separator
                currentGroup.content += '\n\n---\n\n' + message.content;
            }
        }
    }
    
    // Add the last group if it exists
    if (currentGroup) {
        grouped.push(currentGroup);
    }
    
    return grouped;
}

/**
 * Render message content with enhanced markdown support
 */
function renderMessageContent(content) {
    if (typeof content !== 'string') {
        content = JSON.stringify(content, null, 2);
    }

    // Escape HTML first
    let html = escapeHtml(content);

    // Handle code blocks (triple backticks) - must be done before other replacements
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        const langLabel = lang ? `<span class="code-lang">${lang}</span>` : '';
        const codeId = 'code-' + Math.random().toString(36).substr(2, 9);
        return `<pre><button class="code-copy-btn" onclick="copyCode('${codeId}')">📋 Copy</button>${langLabel}<code id="${codeId}">${code.trim()}</code></pre>`;
    });

    // Handle inline code (single backticks)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Split into lines for processing headings and lists
    let lines = html.split('\n');
    let inList = false;
    let inOrderedList = false;
    let processedLines = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        let processed = false;

        // Handle headings (## Heading)
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const text = headingMatch[2];
            processedLines.push(`<h${level}>${text}</h${level}>`);
            processed = true;
        }

        // Handle unordered lists (- item or * item)
        const unorderedMatch = line.match(/^[\s]*[-*]\s+(.+)$/);
        if (unorderedMatch && !processed) {
            if (!inList) {
                processedLines.push('<ul>');
                inList = true;
            }
            processedLines.push(`<li>${unorderedMatch[1]}</li>`);
            processed = true;
        } else if (inList && !unorderedMatch) {
            processedLines.push('</ul>');
            inList = false;
        }

        // Handle ordered lists (1. item)
        const orderedMatch = line.match(/^[\s]*\d+\.\s+(.+)$/);
        if (orderedMatch && !processed) {
            if (!inOrderedList) {
                processedLines.push('<ol>');
                inOrderedList = true;
            }
            processedLines.push(`<li>${orderedMatch[1]}</li>`);
            processed = true;
        } else if (inOrderedList && !orderedMatch) {
            processedLines.push('</ol>');
            inOrderedList = false;
        }

        // Regular line
        if (!processed) {
            // Add line break for non-empty lines
            if (line.trim()) {
                processedLines.push(line + '<br>');
            } else {
                // Empty line creates paragraph break
                processedLines.push('<br>');
            }
        }
    }

    // Close any open lists
    if (inList) processedLines.push('</ul>');
    if (inOrderedList) processedLines.push('</ol>');

    html = processedLines.join('\n');

    // Handle bold text (**text** or __text__)
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // Handle italic text (*text* or _text_)
    html = html.replace(/(?<!\*)\*(?!\*)([^*]+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/(?<!_)_(?!_)([^_]+?)(?<!_)_(?!_)/g, '<em>$1</em>');

    // Handle links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // Handle horizontal rules (---, ***, ___)
    html = html.replace(/^[\s]*[-*_]{3,}[\s]*<br>/gm, '<hr>');

    // Handle blockquotes (> text)
    html = html.replace(/^&gt;\s+(.+)<br>/gm, '<blockquote>$1</blockquote>');

    return html;
}

/**
 * Format date for display (e.g., "Nov 10, 2026")
 */
function formatDate(timestamp) {
    try {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) {
            return 'Today';
        } else if (days === 1) {
            return 'Yesterday';
        } else if (days < 7) {
            return `${days} days ago`;
        } else {
            return date.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric',
                year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
            });
        }
    } catch (error) {
        return 'Unknown date';
    }
}

/**
 * Format timestamp for message display
 */
function formatTimestamp(timestamp) {
    try {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit'
        });
    } catch (error) {
        return '';
    }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}


/**
 * Settings functions
 */

function openSettings() {
    document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettings() {
    document.getElementById('settings-modal').classList.add('hidden');
}

function loadSettings() {
    // Load settings from localStorage
    const savedGroupMessages = localStorage.getItem('groupMessages');
    if (savedGroupMessages !== null) {
        groupMessages = savedGroupMessages === 'true';
        document.getElementById('group-messages-toggle').checked = groupMessages;
    }
}

function toggleMessageGrouping() {
    groupMessages = document.getElementById('group-messages-toggle').checked;
    
    // Save to localStorage
    localStorage.setItem('groupMessages', groupMessages);
    
    // Re-render folder view with updated counts
    if (typeof loadFolder === 'function' && currentFolderId !== undefined) {
        loadFolder(currentFolderId);
    }
    
    // Re-render current session if one is loaded
    if (currentSessionId) {
        // Fetch and re-render the current session
        fetch(`/api/session/${currentSessionId}`)
            .then(response => response.json())
            .then(data => {
                renderMessages(data.messages);
                
                // Update session info with correct count
                const session = sessions.find(s => s.id === currentSessionId);
                const messageCount = groupMessages ? session.grouped_message_count : session.message_count;
                sessionInfo.textContent = session 
                    ? `${formatDate(session.timestamp)} • ${messageCount} messages`
                    : `${messageCount} messages`;
                
                // Scroll to bottom
                setTimeout(() => {
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                }, 100);
            })
            .catch(error => {
                console.error('Error reloading session:', error);
            });
    }
}


/**
 * Search functions
 */

function handleSearchInput(event) {
    if (event.key === 'Enter') {
        performSearch();
    }
}

function performSearch() {
    const query = document.getElementById('search-input').value.trim();
    
    if (query.length < 2) {
        alert('Please enter at least 2 characters to search');
        return;
    }
    
    // Show search modal
    document.getElementById('search-modal').classList.remove('hidden');
    
    const resultsContainer = document.getElementById('search-results-container');
    resultsContainer.innerHTML = '<div class="search-loading">Searching sessions...</div>';
    
    // Perform search
    fetch(`/api/search?q=${encodeURIComponent(query)}`)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                resultsContainer.innerHTML = `<div class="search-no-results">${data.error}</div>`;
                return;
            }
            
            if (data.results.length === 0) {
                resultsContainer.innerHTML = `
                    <div class="search-no-results">
                        <div class="search-no-results-icon">🔍</div>
                        <p>No results found for "${escapeHtml(query)}"</p>
                    </div>
                `;
                return;
            }
            
            renderSearchResults(data.results, query);
        })
        .catch(error => {
            console.error('Search error:', error);
            resultsContainer.innerHTML = '<div class="search-no-results">Error performing search</div>';
        });
}

function renderSearchResults(results, query) {
    const resultsContainer = document.getElementById('search-results-container');
    
    resultsContainer.innerHTML = results.map(result => {
        // Highlight the query in the context
        const highlightedContext = highlightQuery(result.match_context, query);
        
        return `
            <div class="search-result-item" onclick="openSearchResult('${result.session_id}', ${result.message_index})">
                <div class="search-result-session">${escapeHtml(result.session_title)}</div>
                <div class="search-result-meta">
                    <span>${formatDate(result.session_date)}</span>
                    <span>•</span>
                    <span>${result.message_type === 'user' ? '👤 User' : '🤖 Assistant'}</span>
                </div>
                <div class="search-result-match">${highlightedContext}</div>
            </div>
        `;
    }).join('');
}

function highlightQuery(text, query) {
    const escaped = escapeHtml(text);
    const queryEscaped = escapeHtml(query);
    
    // Case-insensitive replace
    const regex = new RegExp(`(${queryEscaped})`, 'gi');
    return escaped.replace(regex, '<span class="search-highlight">$1</span>');
}

function openSearchResult(sessionId, messageIndex) {
    // Close search modal
    closeSearch();
    
    // Clear search input
    document.getElementById('search-input').value = '';
    
    // Load the session
    loadSession(sessionId).then(() => {
        // Scroll to the specific message
        setTimeout(() => {
            const messages = document.querySelectorAll('.message');
            if (messages[messageIndex]) {
                messages[messageIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                // Highlight the message briefly
                messages[messageIndex].style.backgroundColor = '#fffde7';
                setTimeout(() => {
                    messages[messageIndex].style.backgroundColor = '';
                }, 2000);
            }
        }, 200);
    });
}

function closeSearch() {
    document.getElementById('search-modal').classList.add('hidden');
}

// Update loadSession to return a promise
async function loadSession(sessionId) {
    if (currentSessionId === sessionId) return;

    try {
        currentSessionId = sessionId;

        // Update active state in sidebar
        document.querySelectorAll('.session-item').forEach(item => {
            item.classList.toggle('active', item.dataset.sessionId === sessionId);
        });

        // Show loading state
        messagesContainer.innerHTML = '<div class="loading">Loading messages...</div>';
        welcomeMessage.style.display = 'none';
        sessionContent.classList.remove('hidden');

        // Fetch session data
        const response = await fetch(`/api/session/${sessionId}`);
        const data = await response.json();

        // Find session metadata
        const session = sessions.find(s => s.id === sessionId);

        // Calculate correct message count based on grouping setting
        const displayCount = groupMessages 
            ? (session ? session.grouped_message_count : calculateGroupedCount(data.messages))
            : data.messages.length;

        // Update header
        sessionTitle.textContent = session ? session.title : 'Session';
        sessionInfo.textContent = session 
            ? `${formatDate(session.timestamp)} • ${displayCount} messages`
            : `${displayCount} messages`;

        // Render messages
        renderMessages(data.messages);

        // Scroll to bottom
        setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 100);

    } catch (error) {
        console.error('Error loading session:', error);
        messagesContainer.innerHTML = '<div class="loading">Error loading session</div>';
    }
}


/**
 * Rename Modal functions (exposed globally for HTML onclick)
 */
function closeRenameModal() {
    document.getElementById('rename-modal').classList.add('hidden');
    renameTarget = null;
}

async function confirmRename() {
    const newName = document.getElementById('rename-input').value.trim();
    
    if (!newName || !renameTarget) {
        closeRenameModal();
        return;
    }
    
    // Save reference before any async operations
    const targetType = renameTarget.type;
    const targetId = renameTarget.id;
    
    try {
        const endpoint = targetType === 'folder' 
            ? '/api/folder/rename'
            : '/api/session/rename';
        
        const body = targetType === 'folder'
            ? {folder_id: targetId, name: newName}
            : {session_id: targetId, name: newName};
        
        console.log('Renaming:', targetType, body);
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });
        
        const data = await response.json();
        console.log('Rename response:', data);
        
        if (data.success) {
            // Close modal first
            closeRenameModal();
            
            if (targetType === 'folder') {
                // Reload current folder
                if (typeof loadFolder === 'function') {
                    await loadFolder(currentFolderId);
                }
            } else {
                // Update session in memory
                const session = sessions.find(s => s.id === targetId);
                if (session) {
                    session.custom_name = newName;
                }
                
                // Reload current folder view
                if (typeof loadFolder === 'function') {
                    await loadFolder(currentFolderId);
                }
                
                // Update header if this is the current session
                if (currentSessionId === targetId) {
                    document.getElementById('session-title').textContent = newName;
                }
            }
        } else {
            alert('Failed to rename: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error renaming:', error);
        alert('Failed to rename: ' + error.message);
    }
}


/**
 * Copy code to clipboard
 */
function copyCode(codeId) {
    const codeElement = document.getElementById(codeId);
    if (!codeElement) return;
    
    const code = codeElement.textContent;
    
    navigator.clipboard.writeText(code).then(() => {
        // Find the button for this code block
        const pre = codeElement.closest('pre');
        const btn = pre.querySelector('.code-copy-btn');
        
        // Show feedback
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied!';
        btn.classList.add('copied');
        
        setTimeout(() => {
            btn.textContent = originalText;
            btn.classList.remove('copied');
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy code:', err);
        alert('Failed to copy code to clipboard');
    });
}


/**
 * Reset session name to default (remove custom name)
 */
async function resetToDefaultName() {
    if (!renameTarget || renameTarget.type !== 'session') {
        closeRenameModal();
        return;
    }
    
    const targetId = renameTarget.id;
    const defaultName = renameTarget.defaultName;
    
    try {
        // Send empty string or null to reset to default
        const response = await fetch('/api/session/reset-name', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                session_id: targetId
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            closeRenameModal();
            
            // Update session in memory
            const session = sessions.find(s => s.id === targetId);
            if (session) {
                delete session.custom_name;
            }
            
            // Reload current folder view
            if (typeof loadFolder === 'function') {
                await loadFolder(currentFolderId);
            }
            
            // Update header if this is the current session
            if (currentSessionId === targetId) {
                document.getElementById('session-title').textContent = defaultName;
            }
        } else {
            alert('Failed to reset name: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error resetting name:', error);
        alert('Failed to reset name: ' + error.message);
    }
}
