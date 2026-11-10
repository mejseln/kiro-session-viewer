/**
 * Folder Management for Kiro Session Viewer
 * Handles folder navigation, rename, and organization
 */

// State
let currentFolderId = null;
let currentFolderPath = [];

/**
 * Load folder contents and display
 */
async function loadFolder(folderId = null) {
    currentFolderId = folderId;
    
    try {
        // Fetch folder contents
        const url = folderId 
            ? `/api/folders?folder_id=${folderId}`
            : '/api/folders';
        
        const response = await fetch(url);
        const data = await response.json();
        
        currentFolderPath = data.path || [];
        
        // Render breadcrumb
        renderBreadcrumb();
        
        // Render folders and sessions
        renderFoldersAndSessions(data.folders, data.session_ids);
        
    } catch (error) {
        console.error('Error loading folder:', error);
    }
}

/**
 * Render breadcrumb navigation
 */
function renderBreadcrumb() {
    const breadcrumb = document.getElementById('folder-breadcrumb');
    
    if (currentFolderPath.length === 0) {
        breadcrumb.classList.add('hidden');
        return;
    }
    
    breadcrumb.classList.remove('hidden');
    
    let html = '<span class="breadcrumb-item" onclick="loadFolder(null)">🏠 Root</span>';
    
    currentFolderPath.forEach((folder, index) => {
        html += '<span class="breadcrumb-separator">›</span>';
        html += `<span class="breadcrumb-item" onclick="loadFolder('${folder.id}')">${escapeHtml(folder.name)}</span>`;
    });
    
    breadcrumb.innerHTML = html;
}

/**
 * Render folders and sessions in the sidebar
 */
function renderFoldersAndSessions(folders, sessionIds) {
    const sessionList = document.getElementById('session-list');
    
    // Filter sessions to only those we have metadata for
    const sessionsInFolder = sessions.filter(s => sessionIds.includes(s.id));
    
    let html = '';
    
    // Add a drop zone for root if we're not at root
    if (currentFolderId !== null) {
        html += `
            <div class="root-drop-zone" 
                 ondragover="handleDragOver(event)"
                 ondrop="handleDropToRoot(event)"
                 ondragleave="handleDragLeave(event)">
                📤 Drop here to move to root
            </div>
        `;
    }
    
    // Render folders first
    folders.forEach(folder => {
        html += `
            <div class="folder-item" 
                 draggable="true" 
                 data-folder-id="${folder.id}"
                 ondragstart="handleDragStart(event, 'folder', '${folder.id}')"
                 ondragover="handleDragOver(event)"
                 ondrop="handleDrop(event, 'folder', '${folder.id}')"
                 ondragleave="handleDragLeave(event)"
                 onclick="loadFolder('${folder.id}')">
                <div class="item-content">
                    <div class="session-item-title">📁 ${escapeHtml(folder.name)}</div>
                </div>
                <div class="item-actions">
                    <button class="item-action-btn" onclick="event.stopPropagation(); startRenameFolder('${folder.id}', '${escapeHtml(folder.name).replace(/'/g, "\\'")}')">✏️</button>
                    <button class="item-action-btn" onclick="event.stopPropagation(); deleteFolder('${folder.id}')">🗑️</button>
                </div>
            </div>
        `;
    });
    
    // Render sessions
    sessionsInFolder.forEach(session => {
        const messageCount = groupMessages ? session.grouped_message_count : session.message_count;
        const displayName = session.custom_name || session.title;
        
        html += `
            <div class="session-item" 
                 draggable="true"
                 data-session-id="${session.id}" 
                 ondragstart="handleDragStart(event, 'session', '${session.id}')"
                 onclick="loadSession('${session.id}')">
                <div class="item-content">
                    <div class="session-item-title">${escapeHtml(displayName)}</div>
                    <div class="session-item-meta">
                        <span class="session-item-date">${formatDate(session.timestamp)}</span>
                        <span class="session-item-count">${messageCount} messages</span>
                    </div>
                </div>
                <div class="item-actions">
                    <button class="item-action-btn" onclick="event.stopPropagation(); startRenameSession('${session.id}', '${escapeHtml(displayName).replace(/'/g, "\\'")}')">✏️</button>
                </div>
            </div>
        `;
    });
    
    if (html === '' || (currentFolderId === null && folders.length === 0 && sessionsInFolder.length === 0)) {
        html = '<div class="loading">No sessions or folders here</div>';
    }
    
    sessionList.innerHTML = html;
    
    // Update count (sessions only, not folders)
    document.getElementById('session-count').textContent = sessionsInFolder.length;
}

/**
 * Create a new folder
 */
async function createNewFolder() {
    const name = prompt('Enter folder name:', 'New Folder');
    
    if (!name || name.trim() === '') return;
    
    try {
        const response = await fetch('/api/folder/create', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                name: name.trim(),
                parent_id: currentFolderId
            })
        });
        
        const data = await response.json();
        
        if (data.folder_id) {
            // Reload current folder
            await loadFolder(currentFolderId);
        }
    } catch (error) {
        console.error('Error creating folder:', error);
        alert('Failed to create folder');
    }
}

/**
 * Start rename process for folder
 */
function startRenameFolder(folderId, currentName) {
    renameTarget = {type: 'folder', id: folderId, currentName};
    openRenameModal('Rename Folder', currentName);
}

/**
 * Start rename process for session
 */
function startRenameSession(sessionId, currentName) {
    // Find the session to get its default title
    const session = sessions.find(s => s.id === sessionId);
    const defaultName = session ? session.title : currentName;
    
    renameTarget = {
        type: 'session', 
        id: sessionId, 
        currentName: currentName,
        defaultName: defaultName
    };
    
    openRenameModal('Rename Session', currentName);
    
    // Show reset button only if the session has a custom name
    const resetBtn = document.getElementById('reset-name-btn');
    if (session && session.custom_name) {
        resetBtn.style.display = 'inline-block';
    } else {
        resetBtn.style.display = 'none';
    }
}

/**
 * Open rename modal
 */
function openRenameModal(title, currentName) {
    document.getElementById('rename-modal-title').textContent = title;
    document.getElementById('rename-input').value = currentName;
    document.getElementById('rename-modal').classList.remove('hidden');
    document.getElementById('rename-input').focus();
    document.getElementById('rename-input').select();
}

/**
 * Delete a folder
 */
async function deleteFolder(folderId) {
    if (!confirm('Delete this folder? Contents will be moved to the parent folder.')) {
        return;
    }
    
    try {
        const response = await fetch('/api/folder/delete', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({folder_id: folderId})
        });
        
        const data = await response.json();
        
        if (data.success) {
            await loadFolder(currentFolderId);
        }
    } catch (error) {
        console.error('Error deleting folder:', error);
        alert('Failed to delete folder');
    }
}

/**
 * Update search to use current folder
 */
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
    
    // Build URL with folder filter if applicable
    let url = `/api/search?q=${encodeURIComponent(query)}`;
    if (currentFolderId) {
        url += `&folder_id=${currentFolderId}`;
    }
    
    // Perform search
    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                resultsContainer.innerHTML = `<div class="search-no-results">${data.error}</div>`;
                return;
            }
            
            if (data.results.length === 0) {
                const scope = currentFolderId ? ' in this folder' : '';
                resultsContainer.innerHTML = `
                    <div class="search-no-results">
                        <div class="search-no-results-icon">🔍</div>
                        <p>No results found for "${escapeHtml(query)}"${scope}</p>
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

// Handle Enter key in rename modal
document.addEventListener('DOMContentLoaded', () => {
    const renameInput = document.getElementById('rename-input');
    if (renameInput) {
        renameInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                confirmRename();
            } else if (e.key === 'Escape') {
                closeRenameModal();
            }
        });
    }
});


/**
 * Drag and Drop functionality
 */

let draggedItem = null;

function handleDragStart(event, type, id) {
    draggedItem = { type, id };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/html', event.target.innerHTML);
    event.target.style.opacity = '0.4';
}

function handleDragOver(event) {
    if (event.preventDefault) {
        event.preventDefault();
    }
    event.dataTransfer.dropEffect = 'move';
    
    // Add visual feedback
    const target = event.currentTarget;
    if (target.classList.contains('folder-item')) {
        target.style.backgroundColor = '#e3f2fd';
    }
    
    return false;
}

function handleDragLeave(event) {
    const target = event.currentTarget;
    target.style.backgroundColor = '';
}

async function handleDrop(event, targetType, targetId) {
    if (event.stopPropagation) {
        event.stopPropagation();
    }
    
    event.preventDefault();
    
    // Remove visual feedback
    const target = event.currentTarget;
    target.style.backgroundColor = '';
    
    // Reset opacity of dragged item
    document.querySelectorAll('[draggable="true"]').forEach(el => {
        el.style.opacity = '1';
    });
    
    if (!draggedItem) return;
    
    // Don't allow dropping a folder into itself
    if (draggedItem.type === 'folder' && draggedItem.id === targetId) {
        draggedItem = null;
        return false;
    }
    
    // Allow dropping sessions or folders into folders
    if (targetType === 'folder') {
        if (draggedItem.type === 'session') {
            await moveSessionToFolder(draggedItem.id, targetId);
        } else if (draggedItem.type === 'folder') {
            await moveFolderToFolder(draggedItem.id, targetId);
        }
    }
    
    draggedItem = null;
    
    return false;
}

async function handleDropToRoot(event) {
    if (event.stopPropagation) {
        event.stopPropagation();
    }
    
    event.preventDefault();
    
    // Remove visual feedback
    const target = event.currentTarget;
    target.style.backgroundColor = '';
    
    // Reset opacity of dragged item
    document.querySelectorAll('[draggable="true"]').forEach(el => {
        el.style.opacity = '1';
    });
    
    if (!draggedItem) return;
    
    // Move session or folder to root
    if (draggedItem.type === 'session') {
        await moveSessionToFolder(draggedItem.id, null);
    } else if (draggedItem.type === 'folder') {
        await moveFolderToFolder(draggedItem.id, null);
    }
    
    draggedItem = null;
    
    return false;
}

/**
 * Move session to a folder
 */
async function moveSessionToFolder(sessionId, folderId) {
    try {
        const response = await fetch('/api/session/move', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                session_id: sessionId,
                folder_id: folderId
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Reload current folder
            await loadFolder(currentFolderId);
        } else {
            alert('Failed to move session');
        }
    } catch (error) {
        console.error('Error moving session:', error);
        alert('Failed to move session');
    }
}

/**
 * Move folder to another folder or root
 */
async function moveFolderToFolder(folderId, targetFolderId) {
    try {
        const response = await fetch('/api/folder/move', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                folder_id: folderId,
                parent_id: targetFolderId
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Reload current folder
            await loadFolder(currentFolderId);
        } else {
            alert('Failed to move folder: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error moving folder:', error);
        alert('Failed to move folder');
    }
}

// Reset opacity when drag ends
document.addEventListener('dragend', (event) => {
    if (event.target.hasAttribute('draggable')) {
        event.target.style.opacity = '1';
    }
});
