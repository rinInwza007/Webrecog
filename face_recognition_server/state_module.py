# ==================== State Layer ====================
# Responsible for: Database operations, Caching, State Management
# Dependencies: Supabase, Redis (future)

import json
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime
import threading
from supabase import Client, create_client
import os
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Load environment
load_dotenv()

class SupabaseStateManager:
    """Handle all Supabase database operations"""
    
    def __init__(self):
        self.supabase_url = os.getenv("SUPABASE_URL")
        self.supabase_key = os.getenv("SUPABASE_ANON_KEY")
        
        if not self.supabase_url or not self.supabase_key:
            raise ValueError("SUPABASE_URL and SUPABASE_ANON_KEY must be set")
        
        self.client: Client = create_client(self.supabase_url, self.supabase_key)
    
    def get_client(self) -> Client:
        """Get Supabase client"""
        return self.client
    
    # ==================== Student Embeddings ====================
    
    def save_embedding(self, student_id: str, embedding_data: Dict[str, Any]) -> bool:
        """Save face embedding to database"""
        try:
            result = self.client.table('student_face_embeddings').insert(embedding_data).execute()
            if result.data:
                logger.info(f"✅ Embedding saved for {student_id}")
                return True
            return False
        except Exception as e:
            logger.error(f"Error saving embedding for {student_id}: {e}")
            return False
    
    def deactivate_old_embeddings(self, student_id: str) -> bool:
        """Deactivate previous embeddings when new ones are enrolled"""
        try:
            self.client.table('student_face_embeddings').update({
                'is_active': False,
                'updated_at': datetime.now().isoformat()
            }).eq('student_id', student_id).execute()
            return True
        except Exception as e:
            logger.error(f"Error deactivating embeddings for {student_id}: {e}")
            return False
    
    def get_active_embeddings(self, student_id: str) -> List[Dict]:
        """Get all active embeddings for a student"""
        try:
            result = self.client.table('student_face_embeddings').select('*')\
                .eq('student_id', student_id)\
                .eq('is_active', True)\
                .execute()
            return result.data or []
        except Exception as e:
            logger.error(f"Error retrieving embeddings for {student_id}: {e}")
            return []
    
    # ==================== Students ====================
    
    def get_enrolled_students_for_class(self, class_id: str) -> List[str]:
        """Get list of enrolled student IDs for a class"""
        try:
            result = self.client.table('enrollments').select('student_id')\
                .eq('class_id', class_id)\
                .execute()
            return [r['student_id'] for r in result.data] if result.data else []
        except Exception as e:
            logger.error(f"Error getting enrolled students for class {class_id}: {e}")
            return []
    
    def get_student_email(self, student_id: str) -> Optional[str]:
        """Get student email by school_id"""
        try:
            result = self.client.table('users').select('email')\
                .eq('school_id', student_id)\
                .single()\
                .execute()
            return result.data['email'] if result.data else None
        except Exception as e:
            logger.error(f"Error getting email for {student_id}: {e}")
            return None
    
    # ==================== Attendance ====================
    
    def check_attendance_exists(self, session_id: str, student_email: str) -> bool:
        """Check if attendance already recorded"""
        try:
            result = self.client.table('attendance_records').select('id')\
                .eq('session_id', session_id)\
                .eq('student_email', student_email)\
                .execute()
            return bool(result.data)
        except Exception as e:
            logger.error(f"Error checking attendance: {e}")
            return False
    
    def save_attendance_record(self, record_data: Dict[str, Any]) -> bool:
        """Save attendance record to database"""
        try:
            result = self.client.table('attendance_records').insert(record_data).execute()
            if result.data:
                logger.info(f"✅ Attendance record saved for {record_data.get('student_id')}")
                return True
            return False
        except Exception as e:
            logger.error(f"Error saving attendance record: {e}")
            return False
    
    # ==================== Motion Captures ====================
    
    def save_motion_capture(self, capture_data: Dict[str, Any]) -> bool:
        """Save motion capture event"""
        try:
            result = self.client.table('motion_captures').insert(capture_data).execute()
            return bool(result.data)
        except Exception as e:
            logger.error(f"Error saving motion capture: {e}")
            return False
    
    def update_motion_capture(self, session_id: str, capture_time: str, update_data: Dict) -> bool:
        """Update motion capture record"""
        try:
            self.client.table('motion_captures').update(update_data)\
                .eq('session_id', session_id)\
                .eq('capture_time', capture_time)\
                .execute()
            return True
        except Exception as e:
            logger.error(f"Error updating motion capture: {e}")
            return False


class CacheManager:
    """In-memory cache management with thread safety"""
    
    def __init__(self):
        self.face_cache = {}
        self.embedding_cache = {}
        self.cache_lock = threading.Lock()
    
    def set_face_cache(self, key: str, value: Any) -> None:
        """Set face cache value"""
        with self.cache_lock:
            self.face_cache[key] = value
    
    def get_face_cache(self, key: str) -> Optional[Any]:
        """Get face cache value"""
        with self.cache_lock:
            return self.face_cache.get(key)
    
    def set_embedding_cache(self, student_id: str, embedding: Any) -> None:
        """Set embedding cache value"""
        with self.cache_lock:
            self.embedding_cache[student_id] = embedding
    
    def get_embedding_cache(self, student_id: str) -> Optional[Any]:
        """Get embedding cache value"""
        with self.cache_lock:
            return self.embedding_cache.get(student_id)
    
    def invalidate_student_cache(self, student_id: str) -> None:
        """Invalidate cache for student"""
        with self.cache_lock:
            if student_id in self.embedding_cache:
                del self.embedding_cache[student_id]
            logger.debug(f"Cache invalidated for {student_id}")
    
    def clear_all_cache(self) -> None:
        """Clear all caches"""
        with self.cache_lock:
            self.face_cache.clear()
            self.embedding_cache.clear()
            logger.info("All caches cleared")


# Global instances
supabase_manager = SupabaseStateManager()
cache_manager = CacheManager()
