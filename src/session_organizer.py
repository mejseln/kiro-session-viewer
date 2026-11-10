"""
Session Organizer - Manages custom names and folder structure for sessions
Data is stored separately from the original Kiro session files
"""

import json
from pathlib import Path
from typing import Dict, List, Optional

class SessionOrganizer:
    def __init__(self, data_file: Path):
        self.data_file = data_file
        self.data = self._load_data()
    
    def _load_data(self) -> Dict:
        """Load organization data from file."""
        if not self.data_file.exists():
            return {
                "version": "1.0",
                "folders": {},  # folder_id: {name, parent_id, items}
                "sessions": {},  # session_id: {custom_name, folder_id}
                "root_order": []  # List of folder/session IDs at root level
            }
        
        try:
            with open(self.data_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                # Ensure all required keys exist
                if 'sessions' not in data:
                    data['sessions'] = {}
                if 'folders' not in data:
                    data['folders'] = {}
                if 'root_order' not in data:
                    data['root_order'] = []
                return data
        except Exception as e:
            print(f"Error loading organizer data: {e}")
            return {
                "version": "1.0",
                "folders": {},
                "sessions": {},
                "root_order": []
            }
    
    def _save_data(self):
        """Save organization data to file."""
        # Create parent directory if it doesn't exist
        self.data_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(self.data_file, 'w', encoding='utf-8') as f:
            json.dump(self.data, f, indent=2)
    
    def get_session_name(self, session_id: str, default_name: str) -> str:
        """Get custom name for a session, or return default."""
        session_data = self.data['sessions'].get(session_id, {})
        return session_data.get('custom_name', default_name)
    
    def set_session_name(self, session_id: str, custom_name: str):
        """Set custom name for a session."""
        if session_id not in self.data['sessions']:
            self.data['sessions'][session_id] = {}
        
        self.data['sessions'][session_id]['custom_name'] = custom_name
        self._save_data()
    
    def get_session_folder(self, session_id: str) -> Optional[str]:
        """Get folder ID for a session."""
        session_data = self.data['sessions'].get(session_id, {})
        return session_data.get('folder_id')
    
    def move_session_to_folder(self, session_id: str, folder_id: Optional[str]):
        """Move session to a folder (or root if folder_id is None)."""
        if session_id not in self.data['sessions']:
            self.data['sessions'][session_id] = {}
        
        # Remove from old location
        old_folder = self.data['sessions'][session_id].get('folder_id')
        if old_folder and old_folder in self.data['folders']:
            folder_items = self.data['folders'][old_folder].get('items', [])
            if session_id in folder_items:
                folder_items.remove(session_id)
        elif session_id in self.data.get('root_order', []):
            self.data['root_order'].remove(session_id)
        
        # Add to new location
        if folder_id:
            self.data['sessions'][session_id]['folder_id'] = folder_id
            if folder_id not in self.data['folders']:
                self.data['folders'][folder_id] = {'name': 'New Folder', 'items': []}
            
            if 'items' not in self.data['folders'][folder_id]:
                self.data['folders'][folder_id]['items'] = []
            
            if session_id not in self.data['folders'][folder_id]['items']:
                self.data['folders'][folder_id]['items'].append(session_id)
        else:
            self.data['sessions'][session_id]['folder_id'] = None
            if 'root_order' not in self.data:
                self.data['root_order'] = []
            if session_id not in self.data['root_order']:
                self.data['root_order'].append(session_id)
        
        self._save_data()
    
    def create_folder(self, name: str, parent_id: Optional[str] = None) -> str:
        """Create a new folder and return its ID."""
        import uuid
        folder_id = f"folder_{uuid.uuid4().hex[:8]}"
        
        self.data['folders'][folder_id] = {
            'name': name,
            'parent_id': parent_id,
            'items': []
        }
        
        # Add to parent or root
        if parent_id and parent_id in self.data['folders']:
            if 'items' not in self.data['folders'][parent_id]:
                self.data['folders'][parent_id]['items'] = []
            self.data['folders'][parent_id]['items'].append(folder_id)
        else:
            if 'root_order' not in self.data:
                self.data['root_order'] = []
            self.data['root_order'].append(folder_id)
        
        self._save_data()
        return folder_id
    
    def rename_folder(self, folder_id: str, new_name: str):
        """Rename a folder."""
        if folder_id in self.data['folders']:
            self.data['folders'][folder_id]['name'] = new_name
            self._save_data()
    
    def delete_folder(self, folder_id: str):
        """Delete a folder (moves contents to parent or root)."""
        if folder_id not in self.data['folders']:
            return
        
        folder = self.data['folders'][folder_id]
        parent_id = folder.get('parent_id')
        items = folder.get('items', [])
        
        # Move items to parent or root
        if parent_id and parent_id in self.data['folders']:
            if 'items' not in self.data['folders'][parent_id]:
                self.data['folders'][parent_id]['items'] = []
            self.data['folders'][parent_id]['items'].extend(items)
        else:
            # Moving to root
            if 'root_order' not in self.data:
                self.data['root_order'] = []
            self.data['root_order'].extend(items)
        
        # Update folder_id for sessions being moved
        for item_id in items:
            if not item_id.startswith('folder_') and item_id in self.data['sessions']:
                # It's a session - update its folder_id
                if parent_id:
                    self.data['sessions'][item_id]['folder_id'] = parent_id
                else:
                    # Moving to root - set folder_id to None
                    self.data['sessions'][item_id]['folder_id'] = None
        
        # Remove folder from parent or root
        if parent_id and parent_id in self.data['folders']:
            parent_items = self.data['folders'][parent_id].get('items', [])
            if folder_id in parent_items:
                parent_items.remove(folder_id)
        elif folder_id in self.data.get('root_order', []):
            self.data['root_order'].remove(folder_id)
        
        # Delete folder
        del self.data['folders'][folder_id]
        self._save_data()
    
    def move_folder(self, folder_id: str, new_parent_id: Optional[str]):
        """Move a folder to another folder or root."""
        if folder_id not in self.data['folders']:
            return
        
        # Prevent moving a folder into itself or its descendants
        if new_parent_id == folder_id:
            raise ValueError("Cannot move folder into itself")
        
        # Check if new_parent is a descendant of folder_id
        if new_parent_id:
            current = new_parent_id
            while current:
                if current == folder_id:
                    raise ValueError("Cannot move folder into its own descendant")
                current = self.data['folders'].get(current, {}).get('parent_id')
        
        folder = self.data['folders'][folder_id]
        old_parent_id = folder.get('parent_id')
        
        # Remove from old location
        if old_parent_id and old_parent_id in self.data['folders']:
            old_parent_items = self.data['folders'][old_parent_id].get('items', [])
            if folder_id in old_parent_items:
                old_parent_items.remove(folder_id)
        elif folder_id in self.data.get('root_order', []):
            self.data['root_order'].remove(folder_id)
        
        # Add to new location
        if new_parent_id:
            if new_parent_id not in self.data['folders']:
                raise ValueError(f"Target folder {new_parent_id} does not exist")
            
            if 'items' not in self.data['folders'][new_parent_id]:
                self.data['folders'][new_parent_id]['items'] = []
            
            if folder_id not in self.data['folders'][new_parent_id]['items']:
                self.data['folders'][new_parent_id]['items'].append(folder_id)
            
            folder['parent_id'] = new_parent_id
        else:
            # Moving to root
            if 'root_order' not in self.data:
                self.data['root_order'] = []
            if folder_id not in self.data['root_order']:
                self.data['root_order'].append(folder_id)
            
            folder['parent_id'] = None
        
        self._save_data()
    
    def get_folder_contents(self, folder_id: Optional[str] = None) -> Dict:
        """Get contents of a folder (or root if None)."""
        if folder_id is None:
            # Root level
            items = self.data.get('root_order', [])
        else:
            if folder_id not in self.data['folders']:
                return {'folders': [], 'sessions': []}
            items = self.data['folders'][folder_id].get('items', [])
        
        folders = []
        sessions = []
        
        for item_id in items:
            if item_id.startswith('folder_'):
                if item_id in self.data['folders']:
                    folder = self.data['folders'][item_id]
                    folders.append({
                        'id': item_id,
                        'name': folder.get('name', 'Unnamed Folder'),
                        'parent_id': folder.get('parent_id')
                    })
            else:
                # It's a session ID
                sessions.append(item_id)
        
        return {
            'folders': folders,
            'sessions': sessions
        }
    
    def get_sessions_in_folder_recursive(self, folder_id: Optional[str] = None) -> List[str]:
        """Get all session IDs in a folder and its subfolders."""
        contents = self.get_folder_contents(folder_id)
        session_ids = contents['sessions'].copy()
        
        # Recursively get sessions from subfolders
        for folder in contents['folders']:
            session_ids.extend(self.get_sessions_in_folder_recursive(folder['id']))
        
        return session_ids
    
    def get_folder_path(self, folder_id: str) -> List[Dict]:
        """Get the path from root to the given folder."""
        path = []
        current_id = folder_id
        
        while current_id and current_id in self.data['folders']:
            folder = self.data['folders'][current_id]
            path.insert(0, {
                'id': current_id,
                'name': folder.get('name', 'Unnamed Folder')
            })
            current_id = folder.get('parent_id')
        
        return path
