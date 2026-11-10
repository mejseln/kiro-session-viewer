/**
 * Kiro Session Viewer - Frontend JavaScript
 */

// State
let sessions = [];
let currentSessionId = null;
let groupMessages = false;

// DOM Elements
const sessionList = document.getElementById('session-list');
const sessionCount = document.getElementById('session-count');
const welcomeMessage = document.getElementById('welcome-message');
const sessionContent = document.getElementById('session-content');
const sessionTitle = document.getElementById('session-title');
const sessionInfo = document.getElementById('session-info');
const messagesContainer = document.getElementById('messages-container');

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadSessions();
    loadSettings();
    
    // Close modal when clicking outside
    document.getElementById('settings-modal').addEventListener('click', (e) => {
        if (e.target.id === 'settings-modal') {
            closeSettings();
        }
    });
});

/**
 * Load all sessions from the API
 */
async function loadSessions() {
    try {
        const response = await fetch('/api/sessions');
        sessions = await response.json();
        
        renderSessionList();
    } catch (error) {
        console.error('Error loading sessions:', error);
        sessionList.innerHTML = '<div class="loading">Error loading sessions</div>';
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
 * Group consecutive assistant messages
 */
function groupAssistantMessages(messages) {
    const grouped = [];
    let currentGroup = null;
    
    for (const message of messages) {
        if (message.type === 'user') {
            if (currentGroup) {
                grouped.push(currentGroup);
                currentGroup = null;
            }
            grouped.push(message);
        } else if (message.type === 'assistant') {
            if (!currentGroup) {
                currentGroup = {
                    type: 'assistant',
                    content: message.content,
                    timestamp: message.timestamp
                };
            } else {
                currentGroup.content += '\n\n---\n\n' + message.content;
            }
        }
    }
    
    if (currentGroup) {
        grouped.push(currentGroup);
    }
    
    return grouped;
}

/**
 * Calculate grouped message count
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
 * Render message content with markdown support
 */
function renderMessageContent(content) {
    if (typeof content !== 'string') {
        content = JSON.stringify(content, null, 2);
    }

    let html = escapeHtml(content);

    // Code blocks with copy button
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        const langLabel = lang ? `<span class="code-lang">${lang}</span>` : '';
        const codeId = 'code-' + Math.random().toString(36).substr(2, 9);
        return `<pre><button class="code-copy-btn" onclick="copyCode('${codeId}')">📋 Copy</button>${langLabel}<code id="${codeId}">${code.trim()}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Process line by line for headings and lists
    let lines = html.split('\n');
    let inList = false;
    let inOrderedList = false;
    let processedLines = [];

    for (let line of lines) {
        let processed = false;

        // Headings
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            processedLines.push(`<h${level}>${headingMatch[2]}</h${level}>`);
            processed = true;
        }

        // Unordered lists
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

        // Ordered lists
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

        if (!processed) {
            if (line.trim()) {
                processedLines.push(line + '<br>');
            } else {
                processedLines.push('<br>');
            }
        }
    }

    if (inList) processedLines.push('</ul>');
    if (inOrderedList) processedLines.push('</ol>');

    html = processedLines.join('\n');

    // Bold and italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // Horizontal rules
    html = html.replace(/^[\s]*[-*_]{3,}[\s]*<br>/gm, '<hr>');

    // Blockquotes
    html = html.replace(/^&gt;\s+(.+)<br>/gm, '<blockquote>$1</blockquote>');

    return html;
}

/**
 * Copy code to clipboard
 */
function copyCode(codeId) {
    const codeElement = document.getElementById(codeId);
    if (!codeElement) return;
    
    navigator.clipboard.writeText(codeElement.textContent).then(() => {
        const pre = codeElement.closest('pre');
        const btn = pre.querySelector('.code-copy-btn');
        
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied!';
        btn.classList.add('copied');
        
        setTimeout(() => {
            btn.textContent = originalText;
            btn.classList.remove('copied');
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

/**
 * Format date for display
 */
function formatDate(timestamp) {
    try {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) return 'Today';
        if (days === 1) return 'Yesterday';
        if (days < 7) return `${days} days ago`;
        
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
        });
    } catch (error) {
        return 'Unknown date';
    }
}

/**
 * Format timestamp for messages
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
 * Escape HTML
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
    const saved = localStorage.getItem('groupMessages');
    if (saved !== null) {
        groupMessages = saved === 'true';
        document.getElementById('group-messages-toggle').checked = groupMessages;
    }
}

function toggleMessageGrouping() {
    groupMessages = document.getElementById('group-messages-toggle').checked;
    localStorage.setItem('groupMessages', groupMessages);
    
    renderSessionList();
    
    if (currentSessionId) {
        fetch(`/api/session/${currentSessionId}`)
            .then(response => response.json())
            .then(data => {
                renderMessages(data.messages);
                
                const session = sessions.find(s => s.id === currentSessionId);
                const count = groupMessages ? session.grouped_message_count : session.message_count;
                sessionInfo.textContent = session 
                    ? `${formatDate(session.timestamp)} • ${count} messages`
                    : `${count} messages`;
                
                setTimeout(() => {
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                }, 100);
            });
    }
}
