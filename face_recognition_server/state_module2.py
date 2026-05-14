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

# Try to import offline mode for when Supabase is unavailable
try:
    from offline_mode import get_offline_client, OfflineSupabaseClient
    OFFLINE_MODE_AVAILABLE = True
except ImportError:
    OFFLINE_MODE_AVAILABLE = False
    OfflineSupabaseClient = None

class SupabaseStateManager:
    """Handle all Supabase database operations with fallback to offline mode"""
    
    def __init__(self):
        self.supabase_url = os.getenv("SUPABASE_URL")
        self.supabase_key = os.getenv("SUPABASE_ANON_KEY")
        self.offline_mode = False
        
        if not self.supabase_url or not self.supabase_key:
            raise ValueError("SUPABASE_URL and SUPABASE_ANON_KEY must be set")
        
        try:
            self.client: Client = create_client(self.supabase_url, self.supabase_key)
            logger.info("✅ Connected to Supabase")
        except Exception as e:
            error_msg = str(e)
            if "getaddrinfo failed" in error_msg or "Connection" in error_msg or "resolve" in error_msg:
                logger.warning(f"⚠️  Supabase connection failed: {error_msg}")
                logger.warning("🔌 Switching to OFFLINE MODE - using in-memory storage")
                if OFFLINE_MODE_AVAILABLE:
                    self.client = get_offline_client()
                    self.offline_mode = True
                else:
                    raise ValueError("Cannot connect to Supabase and offline mode not available")
            else:
                raise
    
    def get_client(self):
        """Get Supabase client (or offline mock client)"""
        return self.client
    
    def is_offline_mode(self) -> bool:
        """Check if running in offline mode"""
        return self.offline_mode
    
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
        """Get list of enrolled student school_ids for a class (for face recognition matching)"""
        try:
            # Query the optimized view to get school_ids for faster face recognition
            result = self.client.table('v_student_class_enrollment').select('school_id')\
                .eq('class_id', class_id)\
                .eq('status', 'active')\
                .execute()
            
            school_ids = [r['school_id'] for r in result.data] if result.data else []
            
            if school_ids:
                logger.info(f"✅ Found {len(school_ids)} active students for class {class_id}")
            else:
                logger.warning(f"⚠️  No enrolled students found for class {class_id}")
            
            return school_ids
            
        except Exception as e:
            logger.error(f"Error getting enrolled students for class {class_id}: {e}")
            # Fallback to direct table query if view doesn't exist yet
            try:
                result = self.client.table('student_enrollments').select('student_id')\
                    .eq('class_id', class_id)\
                    .eq('status', 'active')\
                    .execute()
                
                if result.data:
                    # Need to fetch school_ids for each student_id
                    school_ids = []
                    for record in result.data:
                        user = self.client.table('users').select('school_id')\
                            .eq('user_id', record['student_id'])\
                            .single()\
                            .execute()
                        if user.data and user.data.get('school_id'):
                            school_ids.append(user.data['school_id'])
                    return school_ids
            except Exception as e2:
                logger.error(f"Fallback query also failed: {e2}")
            
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
        
    def liveness_log(self, spoof_count: int,session_id: str) -> bool:
        try:
            log_data = {
                "spoof_count": spoof_count,
                "session_id": session_id
            }
            result = self.client.table('liveness_detection_logs').insert(log_data).execute()
            return bool(result.data)
        except Exception as e:
            logger.error(f"Error saving liveness log: {e}")
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


class EmbeddingIndexManager:
    """Manage preloaded embeddings for fast lookup"""
    
    def __init__(self, supabase_mgr: SupabaseStateManager = None):
        self.supabase_mgr = supabase_mgr
        self.embeddings = {}  # {student_id: embedding}
        self.index_lock = threading.Lock()
        self.is_loaded = False
    
    def preload_embeddings(self, class_id: str = None) -> int:
        """Preload all active embeddings from database"""
        try:
            with self.index_lock:
                if not self.supabase_mgr:
                    logger.warning("Supabase manager not available for preloading")
                    return 0
                
                logger.info("🔄 Starting embedding preload...")
                
                # Get all active embeddings
                query = self.supabase_mgr.get_client().table('student_face_embeddings')\
                    .select('student_id, embedding_vector')
                
                if class_id:
                    # Filter by class if provided (requires join in real scenario)
                    logger.info(f"📦 Preloading embeddings for class: {class_id}")
                else:
                    query = query.eq('is_active', True)
                
                result = query.execute()
                
                count = 0
                if result.data:
                    for record in result.data:
                        try:
                            student_id = record.get('student_id')
                            embedding_str = record.get('embedding_vector')
                            
                            if student_id and embedding_str:
                                # Parse embedding (stored as JSON string)
                                embedding = json.loads(embedding_str) if isinstance(embedding_str, str) else embedding_str
                                self.embeddings[student_id] = embedding
                                count += 1
                        except Exception as e:
                            logger.debug(f"Error preloading embedding for student: {e}")
                            continue
                
                self.is_loaded = True
                logger.info(f"✅ Preloaded {count} embeddings from database")
                return count
                
        except Exception as e:
            logger.error(f"Error preloading embeddings: {e}")
            return 0
    
    def get_embedding(self, student_id: str) -> Optional[List]:
        """Get preloaded embedding"""
        with self.index_lock:
            return self.embeddings.get(student_id)
    
    def add_embedding(self, student_id: str, embedding: List) -> None:
        """Add embedding to index"""
        with self.index_lock:
            self.embeddings[student_id] = embedding
            logger.debug(f"Added embedding for {student_id} to index")
    
    def clear_index(self) -> None:
        """Clear all preloaded embeddings"""
        with self.index_lock:
            self.embeddings.clear()
            self.is_loaded = False
            logger.info("Embedding index cleared")
    
    def get_stats(self) -> Dict[str, Any]:
        """Get index statistics"""
        with self.index_lock:
            return {
                'loaded_count': len(self.embeddings),
                'is_loaded': self.is_loaded,
                'student_ids': list(self.embeddings.keys())[:10]  # First 10 for preview
            }


# Global instances
supabase_manager = SupabaseStateManager()
cache_manager = CacheManager()
embedding_index_manager = EmbeddingIndexManager(supabase_manager)
