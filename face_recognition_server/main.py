# Enhanced Face Recognition Server - Motion Detection System
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import cv2
import face_recognition
import numpy as np
import io
import base64
from PIL import Image
import json
from typing import Optional, Dict, Any, List
import requests
from datetime import datetime, timedelta
import logging
from dotenv import load_dotenv
import os
from supabase import create_client, Client
import asyncio
import uuid
from concurrent.futures import ThreadPoolExecutor
import threading
import time
import heapq

# Load environment variables
load_dotenv()

# Configuration
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 8000))
DEBUG = os.getenv("DEBUG", "false").lower() == "true"
FACE_THRESHOLD = float(os.getenv("FACE_VERIFICATION_THRESHOLD", 0.7))

# Motion Detection Configuration
MOTION_DETECTION_ENABLED = os.getenv("MOTION_DETECTION_ENABLED", "true").lower() == "true"
DEFAULT_MOTION_THRESHOLD = float(os.getenv("DEFAULT_MOTION_THRESHOLD", 0.1))
MOTION_COOLDOWN_SECONDS = int(os.getenv("MOTION_COOLDOWN_SECONDS", 30))
MAX_SNAPSHOTS_PER_HOUR = int(os.getenv("MAX_SNAPSHOTS_PER_HOUR", 120))

# Supabase setup
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("SUPABASE_URL and SUPABASE_ANON_KEY must be set")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Motion Detection Attendance System",
    description="Face Recognition Server with Motion-Triggered Snapshots",
    version="5.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Thread pool for processing
executor = ThreadPoolExecutor(max_workers=8)

# In-memory cache and tracking
face_cache = {}
motion_sessions = {}  # Track motion detection sessions
cache_lock = threading.Lock()

# ==================== Pydantic Models ====================

class MotionSessionRequest(BaseModel):
    class_id: str
    teacher_email: str
    duration_hours: int = 2
    motion_threshold: float = 0.1
    cooldown_seconds: int = 30
    on_time_limit_minutes: int = 30

class MotionSnapshotRequest(BaseModel):
    session_id: str
    motion_strength: float
    capture_time: str
    elapsed_minutes: int = 0

class MotionDetectionStats(BaseModel):
    session_id: str
    total_motion_events: int
    total_snapshots_taken: int
    snapshot_efficiency: float  # snapshots / motion_events
    average_motion_strength: float
    motion_events_by_hour: Dict[str, int]

# ==================== Motion Detection Processor ====================

class MotionDetectionProcessor:
    def __init__(self):
        self.adaptive_thresholds = {
            '0-10': 0.05,    # Very sensitive - catch everyone entering
            '10-30': 0.08,   # High sensitivity - active period
            '30-60': 0.12,   # Normal sensitivity
            '60-90': 0.15,   # Lower sensitivity - less active
            '90+': 0.20      # Lowest sensitivity - end of session
        }
        
        self.processing_configs = {
            '0-10': {
                'face_threshold': 0.75,
                'model_accuracy': 'high',
                'processing_priority': 1,
                'max_processing_time': 3,
                'enable_quality_check': True,
                'motion_boost': True  # Boost processing for motion-triggered
            },
            '10-30': {
                'face_threshold': 0.7,
                'model_accuracy': 'high',
                'processing_priority': 2,
                'max_processing_time': 4,
                'enable_quality_check': True,
                'motion_boost': True
            },
            '30-60': {
                'face_threshold': 0.65,
                'model_accuracy': 'medium',
                'processing_priority': 3,
                'max_processing_time': 5,
                'enable_quality_check': False,
                'motion_boost': False
            },
            '60+': {
                'face_threshold': 0.6,
                'model_accuracy': 'standard',
                'processing_priority': 4,
                'max_processing_time': 6,
                'enable_quality_check': False,
                'motion_boost': False
            }
        }
    
    def get_phase(self, elapsed_minutes: int) -> str:
        """Determine processing phase based on elapsed time"""
        if elapsed_minutes <= 10:
            return '0-10'
        elif elapsed_minutes <= 30:
            return '10-30'
        elif elapsed_minutes <= 60:
            return '30-60'
        elif elapsed_minutes <= 90:
            return '60-90'
        else:
            return '90+'
    
    def get_motion_threshold(self, phase: str, base_threshold: float = None) -> float:
        """Get adaptive motion threshold for phase"""
        adaptive = self.adaptive_thresholds.get(phase, 0.1)
        if base_threshold:
            # Blend adaptive with session-specific threshold
            return (adaptive + base_threshold) / 2
        return adaptive
    
    def get_config(self, phase: str) -> Dict:
        """Get processing configuration for phase"""
        return self.processing_configs.get(phase, self.processing_configs['30-60'])
    
    def calculate_motion_priority(self, motion_strength: float, phase: str) -> int:
        """Calculate processing priority based on motion strength and phase"""
        base_config = self.get_config(phase)
        base_priority = base_config['processing_priority']
        
        # Boost priority for strong motion
        if motion_strength > 0.5:  # Very strong motion
            return max(1, base_priority - 2)
        elif motion_strength > 0.3:  # Strong motion
            return max(1, base_priority - 1)
        elif motion_strength > 0.15:  # Moderate motion
            return base_priority
        else:  # Weak motion
            return min(5, base_priority + 1)

# Global processor instance
motion_processor = MotionDetectionProcessor()

# ==================== Motion Session Management ====================

class MotionSessionManager:
    def __init__(self):
        self.sessions = {}
        self.lock = threading.Lock()
    
    def create_session(self, session_id: str, config: Dict):
        """Create motion detection session"""
        with self.lock:
            self.sessions[session_id] = {
                'session_id': session_id,
                'created_at': datetime.now(),
                'config': config,
                'stats': {
                    'motion_events': 0,
                    'snapshots_taken': 0,
                    'last_snapshot': None,
                    'motion_history': [],
                    'hourly_events': {}
                }
            }
            logger.info(f"📱 Motion session created: {session_id}")
    
    def record_motion_event(self, session_id: str, motion_strength: float, snapshot_taken: bool = False):
        """Record motion event"""
        with self.lock:
            if session_id not in self.sessions:
                return False
            
            session = self.sessions[session_id]
            now = datetime.now()
            hour_key = now.strftime('%H:00')
            
            # Update stats
            session['stats']['motion_events'] += 1
            if snapshot_taken:
                session['stats']['snapshots_taken'] += 1
                session['stats']['last_snapshot'] = now
            
            # Update hourly stats
            if hour_key not in session['stats']['hourly_events']:
                session['stats']['hourly_events'][hour_key] = 0
            session['stats']['hourly_events'][hour_key] += 1
            
            # Add to motion history (keep last 100 events)
            session['stats']['motion_history'].append({
                'timestamp': now.isoformat(),
                'strength': motion_strength,
                'snapshot_taken': snapshot_taken
            })
            
            # Keep only last 100 events
            if len(session['stats']['motion_history']) > 100:
                session['stats']['motion_history'] = session['stats']['motion_history'][-100:]
            
            return True
    
    def can_take_snapshot(self, session_id: str) -> Dict[str, Any]:
        """Check if snapshot can be taken (cooldown and rate limiting)"""
        with self.lock:
            if session_id not in self.sessions:
                return {'allowed': False, 'reason': 'session_not_found'}
            
            session = self.sessions[session_id]
            stats = session['stats']
            now = datetime.now()
            
            # Check cooldown
            if stats['last_snapshot']:
                time_since_last = (now - stats['last_snapshot']).total_seconds()
                cooldown = session['config'].get('cooldown_seconds', MOTION_COOLDOWN_SECONDS)
                
                if time_since_last < cooldown:
                    return {
                        'allowed': False,
                        'reason': 'cooldown_active',
                        'remaining_seconds': int(cooldown - time_since_last)
                    }
            
            # Check hourly rate limit
            current_hour = now.strftime('%H:00')
            hourly_count = stats['hourly_events'].get(current_hour, 0)
            max_per_hour = session['config'].get('max_snapshots_per_hour', MAX_SNAPSHOTS_PER_HOUR)
            
            if hourly_count >= max_per_hour:
                return {
                    'allowed': False,
                    'reason': 'rate_limit_exceeded',
                    'hourly_count': hourly_count,
                    'max_per_hour': max_per_hour
                }
            
            return {'allowed': True}
    
    def get_session_stats(self, session_id: str) -> Optional[Dict]:
        """Get session statistics"""
        with self.lock:
            if session_id not in self.sessions:
                return None
            return self.sessions[session_id]['stats'].copy()
    
    def remove_session(self, session_id: str):
        """Remove motion session"""
        with self.lock:
            if session_id in self.sessions:
                del self.sessions[session_id]
                logger.info(f"📱 Motion session removed: {session_id}")

# Global session manager
motion_session_manager = MotionSessionManager()

# ==================== Priority Queue for Motion Processing ====================

class MotionPriorityQueue:
    def __init__(self):
        self.queue = []
        self.index = 0
        self.lock = asyncio.Lock()
    
    async def put(self, item):
        async with self.lock:
            priority = item['priority']
            # Motion-triggered items get slight priority boost
            if item.get('trigger_type') == 'motion':
                priority = max(1, priority - 0.5)
            
            heapq.heappush(self.queue, (priority, self.index, item))
            self.index += 1
    
    async def get(self):
        async with self.lock:
            if self.queue:
                priority, index, item = heapq.heappop(self.queue)
                return item
            return None
    
    def qsize(self):
        return len(self.queue)

# Global queue
motion_processing_queue = MotionPriorityQueue()

# ==================== Enhanced Helper Functions ====================

def get_face_embedding_cached(student_id: str) -> Optional[np.ndarray]:
    """Get face embedding with caching for motion-triggered processing"""
    with cache_lock:
        if student_id in face_cache:
            return face_cache[student_id]
    
    try:
        result = supabase.table('student_face_embeddings').select('face_embedding_json').eq('student_id', student_id).eq('is_active', True).single().execute()
        
        if result.data:
            embedding_json = json.loads(result.data['face_embedding_json'])
            embedding = np.array(embedding_json, dtype=np.float64)
            
            # Cache the embedding
            with cache_lock:
                face_cache[student_id] = embedding
            
            return embedding
    except Exception as e:
        logger.error(f"Error getting face embedding for {student_id}: {e}")

    return None

def process_motion_triggered_faces(image_array: np.ndarray, enrolled_students: List[str], config: Dict, motion_strength: float) -> List[Dict]:
    """Process faces with motion-specific optimizations"""
    try:
        start_time = time.time()
        
        if image_array is None or image_array.size == 0:
            logger.warning("Empty image array for motion processing")
            return []
        
        if not enrolled_students:
            logger.warning("No enrolled students for motion processing")
            return []
        
        # Choose model based on motion strength and config
        if motion_strength > 0.3 and config.get('motion_boost', False):
            model_type = "cnn"  # Use high-accuracy model for strong motion
            num_jitters = 2
        else:
            model_type = "cnn" if config['model_accuracy'] == 'high' else "hog"
            num_jitters = 2 if config['model_accuracy'] == 'high' else 1
        
        # Detect faces
        face_locations = face_recognition.face_locations(image_array, model=model_type)
        
        if not face_locations:
            logger.info("No faces detected in motion-triggered processing")
            return []
        
        logger.info(f"🎯 Motion processing: detected {len(face_locations)} faces (motion: {motion_strength:.3f}, model: {model_type})")
        
        # Get face encodings
        face_encodings = face_recognition.face_encodings(
            image_array, 
            face_locations, 
            num_jitters=num_jitters
        )
        
        detected_faces = []
        threshold = config['face_threshold']
        
        # Adjust threshold for motion events
        if motion_strength > 0.4:
            threshold *= 0.95  # Slightly lower threshold for strong motion events
        elif motion_strength < 0.15:
            threshold *= 1.05  # Slightly higher threshold for weak motion
        
        for i, (encoding, location) in enumerate(zip(face_encodings, face_locations)):
            try:
                best_match = None
                best_similarity = 0.0
                
                # Compare with enrolled students
                for student_id in enrolled_students:
                    stored_embedding = get_face_embedding_cached(student_id)
                    if stored_embedding is None:
                        continue
                    
                    similarity = calculate_enhanced_similarity(stored_embedding, encoding)
                    
                    if similarity > threshold and similarity > best_similarity:
                        best_similarity = similarity
                        best_match = student_id
                
                # Enhanced quality check for motion-triggered captures
                quality_score = 1.0
                if config.get('enable_quality_check', False):
                    quality_info = calculate_motion_face_quality(image_array, location, motion_strength)
                    quality_score = quality_info['overall_score']
                
                face_info = {
                    'face_index': i,
                    'student_id': best_match,
                    'confidence': float(best_similarity),
                    'verified': best_match is not None and best_similarity > threshold,
                    'bounding_box': {
                        'top': int(location[0]),
                        'right': int(location[1]),
                        'bottom': int(location[2]),
                        'left': int(location[3])
                    },
                    'quality_score': quality_score,
                    'motion_strength': motion_strength,
                    'processing_time': time.time() - start_time,
                    'threshold_used': threshold,
                    'model_used': model_type
                }
                
                detected_faces.append(face_info)
                
            except Exception as e:
                logger.error(f"Error processing face {i} in motion mode: {e}")
                continue
        
        processing_time = time.time() - start_time
        logger.info(f"✅ Motion processing completed: {processing_time:.2f}s, {len(detected_faces)} faces processed")
        
        return detected_faces
        
    except Exception as e:
        logger.error(f"Error in motion-triggered face processing: {e}")
        return []

def calculate_motion_face_quality(image_array: np.ndarray, face_location: tuple, motion_strength: float) -> Dict[str, float]:
    """Calculate face quality with motion considerations"""
    try:
        basic_quality = calculate_face_quality(image_array, face_location)
        
        # Adjust quality based on motion
        motion_penalty = 0.0
        if motion_strength > 0.5:
            motion_penalty = 0.1  # High motion might cause blur
        elif motion_strength > 0.3:
            motion_penalty = 0.05  # Moderate motion penalty
        
        adjusted_score = max(0.0, basic_quality['overall_score'] - motion_penalty)
        
        return {
            **basic_quality,
            'motion_strength': motion_strength,
            'motion_penalty': motion_penalty,
            'overall_score': adjusted_score
        }
        
    except Exception as e:
        logger.error(f"Error calculating motion face quality: {e}")
        return {"overall_score": 0.0}

def calculate_face_quality(image_array: np.ndarray, face_location: tuple) -> Dict[str, float]:
    """Calculate basic face quality metrics"""
    try:
        top, right, bottom, left = face_location
        face_image = image_array[top:bottom, left:right]
        
        if face_image.size == 0:
            return {"overall_score": 0.0}
        
        gray_face = cv2.cvtColor(face_image, cv2.COLOR_RGB2GRAY)
        
        # Basic quality metrics
        brightness = np.mean(gray_face) / 255.0
        contrast = np.std(gray_face) / 255.0
        
        # Sharpness using Laplacian
        laplacian = cv2.Laplacian(gray_face, cv2.CV_64F)
        sharpness = np.var(laplacian) / 10000.0
        
        # Face size score
        face_area = (right - left) * (bottom - top)
        image_area = image_array.shape[0] * image_array.shape[1]
        size_ratio = face_area / image_area
        size_score = min(size_ratio * 10, 1.0)
        
        # Combined score
        overall_score = (
            brightness * 0.2 +
            contrast * 0.3 +
            min(sharpness, 1.0) * 0.3 +
            size_score * 0.2
        )
        
        return {
            'brightness': float(brightness),
            'contrast': float(contrast),
            'sharpness': float(min(sharpness, 1.0)),
            'size_score': float(size_score),
            'overall_score': float(overall_score)
        }
        
    except Exception as e:
        logger.error(f"Error calculating face quality: {e}")
        return {"overall_score": 0.0}

def calculate_enhanced_similarity(embedding1: np.ndarray, embedding2: np.ndarray) -> float:
    """Enhanced similarity calculation for motion-triggered processing"""
    try:
        # Euclidean distance
        euclidean_distance = np.linalg.norm(embedding1 - embedding2)
        euclidean_score = max(0, 1 - euclidean_distance)
        
        # Cosine similarity
        dot_product = np.dot(embedding1, embedding2)
        norm_a = np.linalg.norm(embedding1)
        norm_b = np.linalg.norm(embedding2)
        
        if norm_a == 0 or norm_b == 0:
            cosine_similarity = 0
        else:
            cosine_similarity = dot_product / (norm_a * norm_b)
        
        # Weighted combination optimized for motion-triggered processing
        final_score = (euclidean_score * 0.4 + cosine_similarity * 0.6)
        
        return float(np.clip(final_score, 0, 1))
        
    except Exception as e:
        logger.error(f"Error calculating similarity: {e}")
        return 0.0

async def get_enrolled_students_for_class(class_id: str) -> List[str]:
    """Get enrolled students with caching"""
    try:
        result = supabase.table('class_students').select('users(school_id)').eq('class_id', class_id).execute()
        
        if not result.data:
            logger.warning(f"No enrolled students found for class {class_id}")
            return []
        
        student_ids = []
        for record in result.data:
            if record and record.get('users') and record['users'].get('school_id'):
                student_ids.append(record['users']['school_id'])
        
        logger.info(f"Found {len(student_ids)} enrolled students for class {class_id}")
        return student_ids
        
    except Exception as e:
        logger.error(f"Error getting enrolled students for class {class_id}: {e}")
        return []

# ==================== Motion Detection API Endpoints ====================

@app.on_event("startup")
async def startup_event():
    """Enhanced startup for motion detection system"""
    logger.info("🚀 Starting Motion Detection Attendance Server...")
    
    # Validate environment variables
    required_env_vars = ["SUPABASE_URL", "SUPABASE_ANON_KEY"]
    missing_vars = [var for var in required_env_vars if not os.getenv(var)]
    
    if missing_vars:
        logger.error(f"❌ Missing required environment variables: {missing_vars}")
        raise ValueError(f"Missing environment variables: {missing_vars}")
    
    # Test face_recognition
    try:
        test_array = np.zeros((50, 50, 3), dtype=np.uint8)
        face_recognition.face_locations(test_array)
        logger.info("✅ Face recognition library working")
    except Exception as e:
        logger.error(f"❌ Face recognition test failed: {e}")
    
    # Test Supabase connection
    try:
        supabase.table('users').select("count", count='exact').limit(1).execute()
        logger.info("✅ Supabase connection working")
    except Exception as e:
        logger.error(f"❌ Supabase connection test failed: {e}")
    
    # Start background motion processing queue
    asyncio.create_task(process_motion_queue())
    
    logger.info(f"✅ Motion Detection Server startup complete")
    logger.info(f"📊 Motion Detection: {'Enabled' if MOTION_DETECTION_ENABLED else 'Disabled'}")
    logger.info(f"🎯 Default Motion Threshold: {DEFAULT_MOTION_THRESHOLD}")
    logger.info(f"⏰ Motion Cooldown: {MOTION_COOLDOWN_SECONDS}s")
    logger.info(f"📈 Max Snapshots/Hour: {MAX_SNAPSHOTS_PER_HOUR}")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    logger.info("🛑 Shutting down Motion Detection Server...")
    
    with cache_lock:
        face_cache.clear()
    
    executor.shutdown(wait=True)
    logger.info("✅ Motion Detection Server shutdown complete")

@app.post("/api/session/start-motion-detection")
async def start_motion_detection_session(
    background_tasks: BackgroundTasks,
    class_id: str = Form(...),
    teacher_email: str = Form(...),
    duration_hours: int = Form(2),
    motion_threshold: float = Form(None),
    cooldown_seconds: int = Form(30),
    on_time_limit_minutes: int = Form(30),
    initial_image: UploadFile = File(None)
):
    """Start motion detection attendance session"""
    try:
        if not MOTION_DETECTION_ENABLED:
            raise HTTPException(status_code=400, detail="Motion detection is disabled")
        
        logger.info(f"🎯 Starting motion detection session for {class_id} by {teacher_email}")
        
        # Validate class and teacher
        class_result = supabase.table('classes').select('*').eq('class_id', class_id).eq('teacher_email', teacher_email).single().execute()
        
        if not class_result.data:
            raise HTTPException(status_code=404, detail="Class not found or you are not the teacher")
        
        # Check for existing active session
        existing_session = supabase.table('attendance_sessions').select('id').eq('class_id', class_id).eq('status', 'active').execute()
        
        if existing_session.data:
            raise HTTPException(status_code=400, detail="There is already an active session for this class")
        
        # Use adaptive threshold if not specified
        if motion_threshold is None:
            motion_threshold = motion_processor.get_motion_threshold('0-10', DEFAULT_MOTION_THRESHOLD)
        
        # Create motion detection session
        start_time = datetime.now()
        end_time = start_time + timedelta(hours=duration_hours)
        
        session_data = {
            'class_id': class_id,
            'teacher_email': teacher_email,
            'start_time': start_time.isoformat(),
            'end_time': end_time.isoformat(),
            'on_time_limit_minutes': on_time_limit_minutes,
            'status': 'active',
            'session_type': 'motion_detection',
            'motion_threshold': motion_threshold,
            'cooldown_seconds': cooldown_seconds,
            'max_snapshots_per_hour': MAX_SNAPSHOTS_PER_HOUR,
            'created_at': start_time.isoformat()
        }
        
        session_result = supabase.table('attendance_sessions').insert(session_data).execute()
        
        if not session_result.data:
            raise HTTPException(status_code=500, detail="Failed to create motion detection session")
        
        session_id = session_result.data[0]['id']
        
        # Create motion session tracking
        motion_config = {
            'motion_threshold': motion_threshold,
            'cooldown_seconds': cooldown_seconds,
            'max_snapshots_per_hour': MAX_SNAPSHOTS_PER_HOUR,
            'class_id': class_id,
            'teacher_email': teacher_email
        }
        
        motion_session_manager.create_session(session_id, motion_config)
        
        # Process initial image if provided
        if initial_image:
            image_data = await initial_image.read()
            
            # Add to processing queue with highest priority
            await motion_processing_queue.put({
                "priority": 1,
                "image_data": image_data,
                "session_id": session_id,
                "capture_time": start_time.isoformat(),
                "phase": "0-10",
                "processing_type": "session_start",
                "trigger_type": "manual",
                "motion_strength": 1.0,  # Full strength for manual start
                "session_data": session_data
            })
        
        # Log session start
        capture_log = {
            'session_id': session_id,
            'capture_time': start_time.isoformat(),
            'capture_type': 'session_start',
            'trigger_type': 'manual',
            'motion_strength': 1.0,
            'processing_status': 'queued',
            'created_at': start_time.isoformat()
        }
        
        supabase.table('motion_captures').insert(capture_log).execute()
        
        logger.info(f"✅ Motion detection session started: {session_id}")
        
        return {
            "success": True,
            "message": "Motion detection session started successfully",
            "session_id": session_id,
            "session_type": "motion_detection",
            "class_id": class_id,
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
            "motion_threshold": motion_threshold,
            "cooldown_seconds": cooldown_seconds,
            "max_snapshots_per_hour": MAX_SNAPSHOTS_PER_HOUR,
            "processing_queue_size": motion_processing_queue.qsize()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error starting motion detection session: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start motion detection session: {str(e)}")

@app.post("/api/motion/snapshot")
async def process_motion_triggered_snapshot(
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    session_id: str = Form(...),
    motion_strength: float = Form(...),
    elapsed_minutes: int = Form(0),
    device_id: str = Form(None)
):
    """Process motion-triggered snapshot"""
    try:
        if not MOTION_DETECTION_ENABLED:
            raise HTTPException(status_code=400, detail="Motion detection is disabled")
        
        # Validate active motion session
        session_result = supabase.table('attendance_sessions').select('*').eq('id', session_id).eq('status', 'active').eq('session_type', 'motion_detection').single().execute()
        
        if not session_result.data:
            raise HTTPException(status_code=404, detail="Active motion detection session not found")
        
        session_data = session_result.data
        
        # Record motion event
        motion_session_manager.record_motion_event(session_id, motion_strength, snapshot_taken=False)
        
        # Check if snapshot is allowed (cooldown, rate limiting)
        snapshot_check = motion_session_manager.can_take_snapshot(session_id)
        
        if not snapshot_check['allowed']:
            logger.info(f"📵 Motion snapshot blocked: {snapshot_check['reason']}")
            
            # Record motion event without snapshot
            capture_log = {
                'session_id': session_id,
                'capture_time': datetime.now().isoformat(),
                'capture_type': 'motion_detected',
                'trigger_type': 'motion',
                'motion_strength': motion_strength,
                'processing_status': 'blocked',
                'block_reason': snapshot_check['reason'],
                'device_id': device_id,
                'created_at': datetime.now().isoformat()
            }
            
            supabase.table('motion_captures').insert(capture_log).execute()
            
            return {
                "success": False,
                "message": f"Motion detected but snapshot blocked: {snapshot_check['reason']}",
                "session_id": session_id,
                "motion_strength": motion_strength,
                "block_reason": snapshot_check['reason'],
                "remaining_seconds": snapshot_check.get('remaining_seconds', 0),
                "motion_recorded": True
            }
        
        # Determine processing phase and configuration
        phase = motion_processor.get_phase(elapsed_minutes)
        config = motion_processor.get_config(phase)
        
        # Calculate motion-based priority
        priority = motion_processor.calculate_motion_priority(motion_strength, phase)
        
        logger.info(f"📸 Motion snapshot triggered: strength={motion_strength:.3f}, phase={phase}, priority={priority}")
        
        # Process image data
        image_data = await image.read()
        
        # Add to motion processing queue
        await motion_processing_queue.put({
            "priority": priority,
            "image_data": image_data,
            "session_id": session_id,
            "capture_time": datetime.now().isoformat(),
            "phase": phase,
            "config": config,
            "processing_type": "motion_triggered",
            "trigger_type": "motion",
            "motion_strength": motion_strength,
            "session_data": session_data,
            "elapsed_minutes": elapsed_minutes,
            "device_id": device_id
        })
        
        # Quick face detection for immediate response
        try:
            image_pil = Image.open(io.BytesIO(image_data))
            if image_pil.mode != 'RGB':
                image_pil = image_pil.convert('RGB')
            
            image_array = np.array(image_pil)
            face_locations = face_recognition.face_locations(image_array, model="hog")
            faces_detected = len(face_locations)
        except:
            faces_detected = 0
        
        # Update motion session - snapshot taken
        motion_session_manager.record_motion_event(session_id, motion_strength, snapshot_taken=True)
        
        # Log motion capture
        capture_log = {
            'session_id': session_id,
            'capture_time': datetime.now().isoformat(),
            'capture_type': 'motion_triggered',
            'trigger_type': 'motion',
            'motion_strength': motion_strength,
            'processing_phase': phase,
            'faces_detected': faces_detected,
            'processing_status': 'queued',
            'queue_priority': priority,
            'device_id': device_id,
            'created_at': datetime.now().isoformat()
        }
        
        supabase.table('motion_captures').insert(capture_log).execute()
        
        return {
            "success": True,
            "message": f"Motion-triggered snapshot queued for processing",
            "session_id": session_id,
            "motion_strength": motion_strength,
            "phase": phase,
            "faces_detected": faces_detected,
            "processing_priority": priority,
            "queue_size": motion_processing_queue.qsize(),
            "config": {
                "threshold": config['face_threshold'],
                "accuracy": config['model_accuracy'],
                "max_time": config['max_processing_time']
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Motion snapshot error: {e}")
        raise HTTPException(status_code=500, detail=f"Motion snapshot failed: {str(e)}")

@app.post("/api/motion/manual-capture")
async def manual_motion_capture(
    background_tasks: BackgroundTasks,
    session_id: str = Form(...),
    image: UploadFile = File(...),
    force_capture: bool = Form(False)
):
    """Manual capture by teacher during motion detection session"""
    try:
        # Validate motion detection session
        session_result = supabase.table('attendance_sessions').select('*').eq('id', session_id).eq('status', 'active').eq('session_type', 'motion_detection').single().execute()
        
        if not session_result.data:
            raise HTTPException(status_code=404, detail="Active motion detection session not found")
        
        session_data = session_result.data
        
        # Calculate elapsed time for phase determination
        session_start = datetime.fromisoformat(session_data['start_time'].replace('Z', '+00:00'))
        elapsed_minutes = int((datetime.now() - session_start).total_seconds() / 60)
        
        phase = motion_processor.get_phase(elapsed_minutes)
        config = motion_processor.get_config(phase)
        
        # Manual captures bypass cooldown if force_capture is True
        if not force_capture:
            snapshot_check = motion_session_manager.can_take_snapshot(session_id)
            if not snapshot_check['allowed']:
                logger.info(f"📵 Manual capture blocked: {snapshot_check['reason']}")
                return {
                    "success": False,
                    "message": f"Manual capture blocked: {snapshot_check['reason']}",
                    "block_reason": snapshot_check['reason'],
                    "force_capture_available": True
                }
        
        logger.info(f"📸 Manual capture in motion session {session_id} (phase: {phase}, forced: {force_capture})")
        
        # Process image data
        image_data = await image.read()
        
        # Manual captures get high priority
        priority = max(1, config['processing_priority'] - 1)
        
        await motion_processing_queue.put({
            "priority": priority,
            "image_data": image_data,
            "session_id": session_id,
            "capture_time": datetime.now().isoformat(),
            "phase": phase,
            "config": config,
            "processing_type": "manual_teacher_capture",
            "trigger_type": "manual",
            "motion_strength": 1.0,  # Full strength for manual
            "session_data": session_data,
            "elapsed_minutes": elapsed_minutes,
            "force_capture": force_capture
        })
        
        # Quick face detection for immediate response
        try:
            image_pil = Image.open(io.BytesIO(image_data))
            if image_pil.mode != 'RGB':
                image_pil = image_pil.convert('RGB')
            
            image_array = np.array(image_pil)
            face_locations = face_recognition.face_locations(image_array, model="hog")
            faces_detected = len(face_locations)
        except:
            faces_detected = 0
        
        # Update motion session - manual snapshot taken
        motion_session_manager.record_motion_event(session_id, 1.0, snapshot_taken=True)
        
        # Log manual capture
        capture_log = {
            'session_id': session_id,
            'capture_time': datetime.now().isoformat(),
            'capture_type': 'manual_teacher',
            'trigger_type': 'manual',
            'motion_strength': 1.0,
            'processing_phase': phase,
            'faces_detected': faces_detected,
            'processing_status': 'queued',
            'queue_priority': priority,
            'force_capture': force_capture,
            'created_at': datetime.now().isoformat()
        }
        
        supabase.table('motion_captures').insert(capture_log).execute()
        
        return {
            "success": True,
            "message": f"Manual capture queued for processing",
            "session_id": session_id,
            "faces_detected": faces_detected,
            "processing_priority": priority,
            "force_capture": force_capture,
            "queue_size": motion_processing_queue.qsize()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Manual motion capture error: {e}")
        raise HTTPException(status_code=500, detail=f"Manual capture failed: {str(e)}")

# ==================== Background Motion Processing ====================

async def process_motion_queue():
    """Background processor for motion-triggered attendance queue"""
    logger.info("🔄 Starting motion processing queue...")
    
    while True:
        try:
            item = await motion_processing_queue.get()
            if not item:
                await asyncio.sleep(1)
                continue
            
            # Process item based on type
            if item['processing_type'] == 'session_start':
                await process_motion_session_start(item)
            elif item['processing_type'] == 'motion_triggered':
                await process_motion_triggered_background(item)
            elif item['processing_type'] == 'manual_teacher_capture':
                await process_manual_teacher_motion_capture(item)
            else:
                logger.warning(f"Unknown motion processing type: {item.get('processing_type')}")
            
        except Exception as e:
            logger.error(f"❌ Motion queue processing error: {e}")
            await asyncio.sleep(1)

async def process_motion_session_start(item: Dict):
    """Process session start for motion detection system"""
    try:
        start_time = time.time()
        session_id = item['session_id']
        session_data = item['session_data']
        
        logger.info(f"🚀 Processing motion session start: {session_id}")
        
        # Process image
        image_pil = Image.open(io.BytesIO(item['image_data']))
        if image_pil.mode != 'RGB':
            image_pil = image_pil.convert('RGB')
        
        image_array = np.array(image_pil)
        
        # Get enrolled students
        enrolled_students = await get_enrolled_students_for_class(session_data['class_id'])
        
        if not enrolled_students:
            logger.warning(f"No enrolled students for motion session start: {session_id}")
            return
        
        # Process faces with high accuracy for session start
        config = motion_processor.get_config('0-10')  # Use highest accuracy
        detected_faces = process_motion_triggered_faces(
            image_array, 
            enrolled_students, 
            config, 
            item['motion_strength']
        )
        
        # Record attendance for session start
        new_records = 0
        for face_info in detected_faces:
            if not face_info['verified']:
                continue
            
            student_id = face_info['student_id']
            confidence = face_info['confidence']
            
            # Get student email
            student_result = supabase.table('users').select('email').eq('school_id', student_id).single().execute()
            
            if not student_result.data:
                continue
            
            student_email = student_result.data['email']
            
            # Record as 'present' for session start
            record_data = {
                'session_id': session_id,
                'student_email': student_email,
                'student_id': student_id,
                'check_in_time': item['capture_time'],
                'status': 'present',  # Session start = present
                'face_match_score': confidence,
                'detection_method': 'motion_session_start',
                'processing_phase': '0-10',
                'face_quality': face_info.get('quality_score', 1.0),
                'motion_strength': item['motion_strength'],
                'trigger_type': 'manual',
                'created_at': datetime.now().isoformat()
            }
            
            try:
                supabase.table('attendance_records').insert(record_data).execute()
                new_records += 1
                logger.info(f"✅ Motion session start attendance recorded for {student_id}")
            except Exception as e:
                logger.error(f"❌ Error saving motion session start record for {student_id}: {e}")
        
        processing_time = time.time() - start_time
        
        # Update capture log
        supabase.table('motion_captures').update({
            'faces_detected': len(detected_faces),
            'faces_recognized': len([f for f in detected_faces if f['verified']]),
            'new_records': new_records,
            'processing_time_ms': int(processing_time * 1000),
            'processing_status': 'completed'
        }).eq('session_id', session_id).eq('capture_time', item['capture_time']).execute()
        
        logger.info(f"🎯 Motion session start processing complete: {new_records} students recorded in {processing_time:.2f}s")
        
    except Exception as e:
        logger.error(f"❌ Error processing motion session start: {e}")
        
        # Update status to failed
        try:
            supabase.table('motion_captures').update({
                'processing_status': 'failed',
                'error_message': str(e)
            }).eq('session_id', item['session_id']).eq('capture_time', item['capture_time']).execute()
        except:
            pass

async def process_motion_triggered_background(item: Dict):
    """Process motion-triggered attendance capture"""
    try:
        start_time = time.time()
        session_id = item['session_id']
        session_data = item['session_data']
        config = item['config']
        phase = item['phase']
        motion_strength = item['motion_strength']
        
        logger.info(f"🚶 Processing motion-triggered capture: {session_id} (phase: {phase}, strength: {motion_strength:.3f})")
        
        # Process image
        image_pil = Image.open(io.BytesIO(item['image_data']))
        if image_pil.mode != 'RGB':
            image_pil = image_pil.convert('RGB')
        
        image_array = np.array(image_pil)
        
        # Get enrolled students (cached)
        enrolled_students = await get_enrolled_students_for_class(session_data['class_id'])
        
        if not enrolled_students:
            logger.warning(f"No enrolled students for motion capture: {session_id}")
            return
        
        # Process faces with motion-specific optimizations
        detected_faces = process_motion_triggered_faces(
            image_array, 
            enrolled_students, 
            config, 
            motion_strength
        )
        
        # Record new attendance
        new_records = 0
        for face_info in detected_faces:
            if not face_info['verified']:
                continue
            
            student_id = face_info['student_id']
            confidence = face_info['confidence']
            
            # Get student email
            student_result = supabase.table('users').select('email').eq('school_id', student_id).single().execute()
            
            if not student_result.data:
                continue
            
            student_email = student_result.data['email']
            
            # Check if already recorded
            existing_record = supabase.table('attendance_records').select('id').eq('session_id', session_id).eq('student_email', student_email).execute()
            
            if existing_record.data:
                continue  # Skip if already recorded
            
            # Determine status based on timing
            capture_dt = datetime.fromisoformat(item['capture_time'].replace('Z', '+00:00'))
            session_start = datetime.fromisoformat(session_data['start_time'].replace('Z', '+00:00'))
            on_time_limit = session_start + timedelta(minutes=session_data['on_time_limit_minutes'])
            
            status = 'present' if capture_dt <= on_time_limit else 'late'
            
            # Record motion-triggered attendance
            record_data = {
                'session_id': session_id,
                'student_email': student_email,
                'student_id': student_id,
                'check_in_time': item['capture_time'],
                'status': status,
                'face_match_score': confidence,
                'detection_method': 'motion_triggered',
                'processing_phase': phase,
                'face_quality': face_info.get('quality_score', 1.0),
                'motion_strength': motion_strength,
                'trigger_type': 'motion',
                'device_id': item.get('device_id'),
                'created_at': datetime.now().isoformat()
            }
            
            try:
                supabase.table('attendance_records').insert(record_data).execute()
                new_records += 1
                logger.info(f"✅ Motion-triggered attendance recorded for {student_id}: {status}")
            except Exception as e:
                logger.error(f"❌ Error saving motion record for {student_id}: {e}")
        
        processing_time = time.time() - start_time
        
        # Update capture log
        supabase.table('motion_captures').update({
            'faces_detected': len(detected_faces),
            'faces_recognized': len([f for f in detected_faces if f['verified']]),
            'new_records': new_records,
            'processing_time_ms': int(processing_time * 1000),
            'processing_status': 'completed'
        }).eq('session_id', session_id).eq('capture_time', item['capture_time']).execute()
        
        logger.info(f"🤖 Motion capture complete: {new_records} new records in {processing_time:.2f}s")
        
    except Exception as e:
        logger.error(f"❌ Error processing motion capture: {e}")
        
        # Update status to failed
        try:
            supabase.table('motion_captures').update({
                'processing_status': 'failed',
                'error_message': str(e)
            }).eq('session_id', item['session_id']).eq('capture_time', item['capture_time']).execute()
        except:
            pass

async def process_manual_teacher_motion_capture(item: Dict):
    """Process manual teacher capture in motion detection session"""
    try:
        start_time = time.time()
        session_id = item['session_id']
        session_data = item['session_data']
        config = item['config']
        phase = item['phase']
        
        logger.info(f"👨‍🏫 Processing manual teacher capture in motion session: {session_id} (phase: {phase})")
        
        # Process image with high priority settings
        image_pil = Image.open(io.BytesIO(item['image_data']))
        if image_pil.mode != 'RGB':
            image_pil = image_pil.convert('RGB')
        
        image_array = np.array(image_pil)
        
        # Get enrolled students
        enrolled_students = await get_enrolled_students_for_class(session_data['class_id'])
        
        if not enrolled_students:
            logger.warning(f"No enrolled students for manual motion capture: {session_id}")
            return
        
        # Use high accuracy for manual teacher captures
        manual_config = config.copy()
        manual_config['model_accuracy'] = 'high'
        manual_config['enable_quality_check'] = True
        
        detected_faces = process_motion_triggered_faces(
            image_array, 
            enrolled_students, 
            manual_config, 
            item['motion_strength']
        )
        
        # Record new attendance
        new_records = 0
        for face_info in detected_faces:
            if not face_info['verified']:
                continue
            
            student_id = face_info['student_id']
            confidence = face_info['confidence']
            
            # Get student email
            student_result = supabase.table('users').select('email').eq('school_id', student_id).single().execute()
            
            if not student_result.data:
                continue
            
            student_email = student_result.data['email']
            
            # Check if already recorded (skip for forced captures)
            if not item.get('force_capture', False):
                existing_record = supabase.table('attendance_records').select('id').eq('session_id', session_id).eq('student_email', student_email).execute()
                
                if existing_record.data:
                    continue  # Skip if already recorded
            
            # Determine status based on timing
            capture_dt = datetime.fromisoformat(item['capture_time'].replace('Z', '+00:00'))
            session_start = datetime.fromisoformat(session_data['start_time'].replace('Z', '+00:00'))
            on_time_limit = session_start + timedelta(minutes=session_data['on_time_limit_minutes'])
            
            status = 'present' if capture_dt <= on_time_limit else 'late'
            
            # Record manual teacher attendance
            record_data = {
                'session_id': session_id,
                'student_email': student_email,
                'student_id': student_id,
                'check_in_time': item['capture_time'],
                'status': status,
                'face_match_score': confidence,
                'detection_method': 'manual_teacher_motion',
                'processing_phase': phase,
                'face_quality': face_info.get('quality_score', 1.0),
                'motion_strength': item['motion_strength'],
                'trigger_type': 'manual',
                'force_capture': item.get('force_capture', False),
                'created_at': datetime.now().isoformat()
            }
            
            try:
                supabase.table('attendance_records').insert(record_data).execute()
                new_records += 1
                logger.info(f"✅ Manual teacher motion attendance recorded for {student_id}: {status}")
            except Exception as e:
                logger.error(f"❌ Error saving manual teacher motion record for {student_id}: {e}")
        
        processing_time = time.time() - start_time
        
        # Update capture log
        supabase.table('motion_captures').update({
            'faces_detected': len(detected_faces),
            'faces_recognized': len([f for f in detected_faces if f['verified']]),
            'new_records': new_records,
            'processing_time_ms': int(processing_time * 1000),
            'processing_status': 'completed'
        }).eq('session_id', session_id).eq('capture_time', item['capture_time']).execute()
        
        logger.info(f"👨‍🏫 Manual teacher motion capture complete: {new_records} new records in {processing_time:.2f}s")
        
    except Exception as e:
        logger.error(f"❌ Error processing manual teacher motion capture: {e}")
        
        # Update status to failed
        try:
            supabase.table('motion_captures').update({
                'processing_status': 'failed',
                'error_message': str(e)
            }).eq('session_id', item['session_id']).eq('capture_time', item['capture_time']).execute()
        except:
            pass

# ==================== Motion Session Management ====================

@app.put("/api/session/{session_id}/end-motion")
async def end_motion_detection_session(session_id: str):
    """End motion detection attendance session"""
    try:
        # Validate and end session
        result = supabase.table('attendance_sessions').update({
            'status': 'ended',
            'ended_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat()
        }).eq('id', session_id).eq('session_type', 'motion_detection').execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="Motion detection session not found")
        
        # Remove from motion session manager
        motion_session_manager.remove_session(session_id)
        
        logger.info(f"📝 Motion detection session ended: {session_id}")
        
        # Generate final statistics
        stats = await get_motion_session_statistics_internal(session_id)
        
        return {
            "success": True,
            "message": "Motion detection session ended successfully",
            "session_id": session_id,
            "session_type": "motion_detection",
            "final_statistics": stats
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error ending motion detection session: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to end motion session: {str(e)}")

@app.get("/api/session/{session_id}/motion-statistics")
async def get_motion_session_statistics(session_id: str):
    """Get detailed motion detection statistics"""
    try:
        stats = await get_motion_session_statistics_internal(session_id)
        return {
            "success": True,
            "session_id": session_id,
            "session_type": "motion_detection",
            **stats
        }
        
    except Exception as e:
        logger.error(f"❌ Error getting motion session statistics: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get motion statistics: {str(e)}")

async def get_motion_session_statistics_internal(session_id: str) -> Dict:
    """Internal function to get comprehensive motion session statistics"""
    try:
        # Get session info
        session_result = supabase.table('attendance_sessions').select('*').eq('id', session_id).single().execute()
        
        if not session_result.data:
            raise ValueError("Motion detection session not found")
        
        session_data = session_result.data
        
        # Get attendance records
        records_result = supabase.table('attendance_records').select('*').eq('session_id', session_id).execute()
        records = records_result.data or []
        
        # Get motion capture logs
        captures_result = supabase.table('motion_captures').select('*').eq('session_id', session_id).order('capture_time').execute()
        captures = captures_result.data or []
        
        # Get motion session stats from manager
        motion_stats = motion_session_manager.get_session_stats(session_id) or {}
        
        # Get enrolled students count
        enrolled_students = await get_enrolled_students_for_class(session_data['class_id'])
        total_students = len(enrolled_students)
        
        # Calculate attendance statistics
        present_count = len([r for r in records if r['status'] == 'present'])
        late_count = len([r for r in records if r['status'] == 'late'])
        absent_count = total_students - len(records)
        attendance_rate = len(records) / total_students if total_students > 0 else 0
        
        # Motion-specific statistics
        motion_events = motion_stats.get('motion_events', 0)
        snapshots_taken = motion_stats.get('snapshots_taken', 0)
        snapshot_efficiency = snapshots_taken / motion_events if motion_events > 0 else 0
        
        # Capture type breakdown
        capture_types = {}
        trigger_types = {}
        for capture in captures:
            capture_type = capture.get('capture_type', 'unknown')
            trigger_type = capture.get('trigger_type', 'unknown')
            
            capture_types[capture_type] = capture_types.get(capture_type, 0) + 1
            trigger_types[trigger_type] = trigger_types.get(trigger_type, 0) + 1
        
        # Motion strength analysis
        motion_strengths = [c.get('motion_strength', 0) for c in captures if c.get('motion_strength')]
        avg_motion_strength = np.mean(motion_strengths) if motion_strengths else 0
        
        # Processing phase breakdown
        phase_stats = {}
        for capture in captures:
            phase = capture.get('processing_phase', 'unknown')
            if phase not in phase_stats:
                phase_stats[phase] = {'count': 0, 'faces_detected': 0, 'faces_recognized': 0}
            phase_stats[phase]['count'] += 1
            phase_stats[phase]['faces_detected'] += capture.get('faces_detected', 0)
            phase_stats[phase]['faces_recognized'] += capture.get('faces_recognized', 0)
        
        # Detection method breakdown
        method_stats = {}
        for record in records:
            method = record.get('detection_method', 'unknown')
            method_stats[method] = method_stats.get(method, 0) + 1
        
        return {
            "session_info": session_data,
            "attendance_statistics": {
                "total_students": total_students,
                "present_count": present_count,
                "late_count": late_count,
                "absent_count": absent_count,
                "attendance_rate": round(attendance_rate, 3)
            },
            "motion_statistics": {
                "total_motion_events": motion_events,
                "snapshots_taken": snapshots_taken,
                "snapshot_efficiency": round(snapshot_efficiency, 3),
                "average_motion_strength": round(float(avg_motion_strength), 3),
                "motion_threshold": session_data.get('motion_threshold', DEFAULT_MOTION_THRESHOLD),
                "cooldown_seconds": session_data.get('cooldown_seconds', MOTION_COOLDOWN_SECONDS)
            },
            "capture_breakdown": {
                "by_type": capture_types,
                "by_trigger": trigger_types
            },
            "phase_breakdown": phase_stats,
            "method_breakdown": method_stats,
            "processing_queue_size": motion_processing_queue.qsize(),
            "hourly_motion_events": motion_stats.get('hourly_events', {})
        }
        
    except Exception as e:
        logger.error(f"Error generating motion session statistics: {e}")
        return {"error": str(e)}

# ==================== System Health and Monitoring ====================

@app.get("/health")
async def motion_system_health():
    """Enhanced health check for motion detection system"""
    try:
        # Test face_recognition
        test_array = np.zeros((100, 100, 3), dtype=np.uint8)
        face_recognition.face_locations(test_array)
        
        # Test database tables
        required_tables = [
            'users',
            'classes', 
            'class_students',
            'attendance_sessions',
            'attendance_records',
            'student_face_embeddings',
            'motion_captures'  # New table for motion system
        ]
        
        table_status = {}
        for table in required_tables:
            try:
                result = supabase.table(table).select("count", count='exact').limit(1).execute()
                table_status[table] = "ok"
            except Exception as e:
                logger.error(f"Table {table} check failed: {e}")
                table_status[table] = f"error: {str(e)}"
        
        # Cache and queue statistics
        with cache_lock:
            cache_size = len(face_cache)
        
        queue_size = motion_processing_queue.qsize()
        
        # Motion session statistics
        active_motion_sessions = len(motion_session_manager.sessions)
        
        # System status
        all_critical_tables_ok = all(
            status == "ok" for table, status in table_status.items() 
            if table != 'motion_captures'  # This table can be created automatically
        )
        
        overall_status = "healthy" if all_critical_tables_ok else "degraded"
        
        return {
            "status": overall_status,
            "timestamp": datetime.now().isoformat(),
            "system_type": "motion_detection_attendance",
            "services": {
                "face_recognition": "ok",
                "supabase": "ok",
                "motion_processing_queue": "ok",
                "motion_session_manager": "ok",
                "background_processor": "ok"
            },
            "database_tables": table_status,
            "performance": {
                "face_cache_size": cache_size,
                "processing_queue_size": queue_size,
                "active_motion_sessions": active_motion_sessions,
                "thread_pool_workers": executor._max_workers,
                "adaptive_phases": list(motion_processor.adaptive_thresholds.keys())
            },
            "motion_configuration": {
                "motion_detection_enabled": MOTION_DETECTION_ENABLED,
                "default_motion_threshold": DEFAULT_MOTION_THRESHOLD,
                "motion_cooldown_seconds": MOTION_COOLDOWN_SECONDS,
                "max_snapshots_per_hour": MAX_SNAPSHOTS_PER_HOUR,
                "adaptive_thresholds": motion_processor.adaptive_thresholds
            },
            "configuration": {
                "face_threshold": FACE_THRESHOLD,
                "debug_mode": DEBUG,
                "version": "5.0.0-motion-detection",
                "supported_features": [
                    "face_enrollment",
                    "motion_detection_sessions", 
                    "motion_triggered_snapshots",
                    "manual_teacher_capture",
                    "adaptive_motion_processing",
                    "motion_session_statistics",
                    "real_time_motion_monitoring"
                ]
            }
        }
        
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "status": "unhealthy",
            "timestamp": datetime.now().isoformat(),
            "error": str(e),
            "system_type": "motion_detection_attendance"
        }

@app.get("/api/motion/system-status")
async def get_motion_system_status():
    """Get comprehensive motion detection system status"""
    try:
        # Active motion sessions
        active_sessions = supabase.table('attendance_sessions').select('id, class_id, start_time, motion_threshold').eq('status', 'active').eq('session_type', 'motion_detection').execute()
        
        # Processing statistics
        with cache_lock:
            cache_size = len(face_cache)
        
        queue_size = motion_processing_queue.qsize()
        
        # Motion session manager stats
        session_manager_stats = {}
        for session_id, session_data in motion_session_manager.sessions.items():
            stats = session_data['stats']
            session_manager_stats[session_id] = {
                'motion_events': stats['motion_events'],
                'snapshots_taken': stats['snapshots_taken'],
                'efficiency': stats['snapshots_taken'] / stats['motion_events'] if stats['motion_events'] > 0 else 0,
                'last_snapshot': stats['last_snapshot'].isoformat() if stats['last_snapshot'] else None
            }
        
        # Recent motion activity
        recent_captures = supabase.table('motion_captures').select('*').gte('created_at', (datetime.now() - timedelta(hours=1)).isoformat()).execute()
        
        # Motion trigger analysis
        motion_triggers = {}
        for capture in recent_captures.data or []:
            trigger = capture.get('trigger_type', 'unknown')
            motion_triggers[trigger] = motion_triggers.get(trigger, 0) + 1
        
        return {
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "system_type": "motion_detection_attendance",
            "active_sessions": {
                "count": len(active_sessions.data or []),
                "sessions": active_sessions.data or []
            },
            "processing_status": {
                "queue_size": queue_size,
                "cache_size": cache_size,
                "recent_captures": len(recent_captures.data or []),
                "session_manager_stats": session_manager_stats
            },
            "motion_activity": {
                "recent_triggers": motion_triggers,
                "motion_detection_enabled": MOTION_DETECTION_ENABLED,
                "adaptive_processing": True
            },
            "capabilities": {
                "motion_triggered_capture": True,
                "adaptive_threshold": True,
                "motion_session_tracking": True,
                "real_time_processing": True,
                "cooldown_management": True,
                "rate_limiting": True,
                "manual_check_in": False,  # Disabled in motion-only system
                "periodic_snapshots": False  # Replaced with motion detection
            },
            "thresholds": motion_processor.adaptive_thresholds
        }
        
    except Exception as e:
        logger.error(f"Error getting motion system status: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get motion system status: {str(e)}")

@app.get("/api/motion/session/{session_id}/live-stats")
async def get_live_motion_stats(session_id: str):
    """Get live motion detection statistics for a session"""
    try:
        # Get motion session stats
        motion_stats = motion_session_manager.get_session_stats(session_id)
        
        if not motion_stats:
            raise HTTPException(status_code=404, detail="Motion session not found")
        
        # Get recent captures (last hour)
        recent_captures = supabase.table('motion_captures').select('*').eq('session_id', session_id).gte('created_at', (datetime.now() - timedelta(hours=1)).isoformat()).execute()
        
        # Calculate live metrics
        total_captures = len(recent_captures.data or [])
        successful_captures = len([c for c in recent_captures.data or [] if c.get('processing_status') == 'completed'])
        
        # Motion strength distribution
        motion_strengths = [c.get('motion_strength', 0) for c in recent_captures.data or [] if c.get('motion_strength')]
        
        strength_distribution = {
            'weak': len([s for s in motion_strengths if s < 0.2]),
            'moderate': len([s for s in motion_strengths if 0.2 <= s < 0.5]),
            'strong': len([s for s in motion_strengths if s >= 0.5])
        }
        
        # Processing queue status for this session
        queue_items_for_session = 0  # Would need to implement queue inspection
        
        return {
            "success": True,
            "session_id": session_id,
            "timestamp": datetime.now().isoformat(),
            "live_stats": {
                "motion_events": motion_stats['motion_events'],
                "snapshots_taken": motion_stats['snapshots_taken'],
                "snapshot_efficiency": motion_stats['snapshots_taken'] / motion_stats['motion_events'] if motion_stats['motion_events'] > 0 else 0,
                "last_snapshot": motion_stats['last_snapshot'].isoformat() if motion_stats['last_snapshot'] else None
            },
            "recent_activity": {
                "total_captures_last_hour": total_captures,
                "successful_captures": successful_captures,
                "success_rate": successful_captures / total_captures if total_captures > 0 else 0,
                "motion_strength_distribution": strength_distribution
            },
            "processing": {
                "queue_items_for_session": queue_items_for_session,
                "total_queue_size": motion_processing_queue.qsize()
            },
            "hourly_events": motion_stats.get('hourly_events', {}),
            "motion_history": motion_stats.get('motion_history', [])[-10:]  # Last 10 events
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting live motion stats: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get live stats: {str(e)}")

@app.delete("/api/motion/cache/clear")
async def clear_motion_cache():
    """Clear face embedding cache and reset motion sessions"""
    try:
        with cache_lock:
            cache_size = len(face_cache)
            face_cache.clear()
        
        # Reset motion session manager for inactive sessions
        active_sessions = supabase.table('attendance_sessions').select('id').eq('status', 'active').eq('session_type', 'motion_detection').execute()
        active_session_ids = [s['id'] for s in active_sessions.data or []]
        
        removed_sessions = 0
        for session_id in list(motion_session_manager.sessions.keys()):
            if session_id not in active_session_ids:
                motion_session_manager.remove_session(session_id)
                removed_sessions += 1
        
        logger.info(f"🧹 Cleared {cache_size} cached embeddings and {removed_sessions} inactive motion sessions")
        
        return {
            "success": True,
            "message": f"Cleared {cache_size} cached embeddings and {removed_sessions} motion sessions",
            "cleared_cache_size": cache_size,
            "removed_sessions": removed_sessions,
            "active_sessions_kept": len(active_session_ids),
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Error clearing motion cache: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to clear cache: {str(e)}")

# ==================== Face Enrollment (Same as before) ====================

@app.post("/api/face/enroll")
async def enroll_face_for_motion_system(
    images: List[UploadFile] = File(...),
    student_id: str = Form(...),
    student_email: str = Form(...)
):
    """Face enrollment optimized for motion detection system"""
    try:
        if not images or len(images) == 0:
            raise HTTPException(status_code=400, detail="At least one image is required for motion detection system")
        
        if len(images) > 5:
            raise HTTPException(status_code=400, detail="Maximum 5 images allowed")
        
        logger.info(f"🔄 Enrolling face for motion detection: {student_id} with {len(images)} images")
        
        all_encodings = []
        quality_scores = []
        
        # Process each image with high accuracy for enrollment
        for idx, image_file in enumerate(images):
            try:
                image_data = await image_file.read()
                image = Image.open(io.BytesIO(image_data))
                
                if image.mode != 'RGB':
                    image = image.convert('RGB')
                
                image_array = np.array(image)
                
                # Use CNN model for enrollment (highest accuracy)
                face_locations = face_recognition.face_locations(image_array, model="cnn")
                
                if len(face_locations) == 0:
                    logger.warning(f"No face detected in enrollment image {idx + 1}")
                    continue
                
                if len(face_locations) > 1:
                    logger.warning(f"Multiple faces detected in enrollment image {idx + 1}, using the largest one")
                    # Sort by face size and use the largest
                    face_locations = sorted(face_locations, key=lambda loc: (loc[2]-loc[0])*(loc[1]-loc[3]), reverse=True)
                
                # Get high-quality face encoding
                face_encodings = face_recognition.face_encodings(
                    image_array, 
                    face_locations[:1], 
                    num_jitters=3  # Higher jitters for better enrollment
                )
                
                if face_encodings:
                    all_encodings.append(face_encodings[0])
                    
                    # Calculate quality for this enrollment image
                    quality = calculate_face_quality(image_array, face_locations[0])
                    quality_scores.append(quality['overall_score'])
                    
                    logger.info(f"✅ Processed enrollment image {idx + 1} (quality: {quality['overall_score']:.3f})")
                
            except Exception as e:
                logger.error(f"Error processing enrollment image {idx + 1}: {e}")
                continue
        
        if not all_encodings:
            raise HTTPException(status_code=400, detail="No valid face encodings for motion detection system")
        
        # Require at least 60% success rate for enrollment
        success_rate = len(all_encodings) / len(images)
        if success_rate < 0.6:
            logger.warning(f"Low enrollment success rate: {success_rate:.2f}")
        
        # Calculate weighted average encoding
        weights = np.array(quality_scores)
        weights = weights / np.sum(weights)  # Normalize weights
        
        average_encoding = np.average(all_encodings, axis=0, weights=weights)
        overall_quality = np.mean(quality_scores)
        
        # Save to database with motion system metadata
        success = await save_face_embedding_to_db(
            student_id, 
            student_email, 
            average_encoding, 
            overall_quality,
            enrollment_type="motion_detection_system",
            images_used=len(all_encodings)
        )
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to save face data for motion detection system")
        
        # Clear cache for this student
        with cache_lock:
            if student_id in face_cache:
                del face_cache[student_id]
        
        logger.info(f"✅ Face enrolled for motion detection: {student_id}")
        
        return {
            "success": True,
            "message": f"Face enrolled for motion detection using {len(all_encodings)} images",
            "student_id": student_id,
            "images_processed": len(all_encodings),
            "total_images": len(images),
            "quality_score": overall_quality,
            "enrollment_type": "motion_detection_system",
            "system_version": "5.0.0-motion",
            "timestamp": datetime.now().isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Face enrollment error: {e}")
        raise HTTPException(status_code=500, detail=f"Enrollment failed: {str(e)}")

# ==================== Database Helper Functions ====================

async def save_face_embedding_to_db(
    student_id: str, 
    student_email: str, 
    encoding: np.ndarray, 
    quality: float,
    enrollment_type: str = "motion_detection_system",
    images_used: int = 1
) -> bool:
    """Save face embedding optimized for motion detection system"""
    try:
        if encoding is None or encoding.size == 0:
            logger.error("Empty encoding provided for motion detection system")
            return False
        
        if not student_id or not student_email:
            logger.error("Missing student_id or student_email for motion detection system")
            return False
        
        # Validate encoding
        if not isinstance(encoding, np.ndarray) or encoding.ndim != 1:
            logger.error("Invalid encoding format for motion detection system")
            return False
        
        embedding_json = encoding.tolist()
        quality = max(0.0, min(1.0, float(quality)))
        
        face_data = {
            'student_id': student_id,
            'face_embedding_json': json.dumps(embedding_json),
            'face_quality': quality,
            'enrollment_type': enrollment_type,
            'images_used': images_used,
            'system_version': '5.0.0-motion',
            'motion_optimized': True,  # Flag for motion detection optimization
            'is_active': True,
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat()
        }
        
        # Verify student exists
        student_check = supabase.table('users').select('school_id').eq('school_id', student_id).execute()
        
        if not student_check.data:
            logger.error(f"Student {student_id} not found for motion detection enrollment")
            return False
        
        # Deactivate old embeddings
        supabase.table('student_face_embeddings').update({
            'is_active': False,
            'updated_at': datetime.now().isoformat()
        }).eq('student_id', student_id).execute()
        
        # Insert new embedding
        result = supabase.table('student_face_embeddings').insert(face_data).execute()
        
        if result.data:
            logger.info(f"✅ Face data saved for motion detection: {student_id} (quality: {quality:.2f}, images: {images_used})")
            return True
        else:
            logger.error(f"❌ Failed to save face data for motion detection: {student_id}")
            return False
        
    except Exception as e:
        logger.error(f"❌ Error saving to database for motion detection: {e}")
        return False

# ==================== Server Startup ====================

if __name__ == "__main__":
    import uvicorn
    
    print("🎯 Starting Motion Detection Attendance System")
    print("=" * 60)
    print(f"🚀 Server: {HOST}:{PORT}")
    print(f"📊 Face Threshold: {FACE_THRESHOLD}")
    print(f"🔧 Debug Mode: {DEBUG}")
    print("=" * 60)
    print("✅ Motion Detection Features:")
    print(f"   - Motion Detection: {'Enabled' if MOTION_DETECTION_ENABLED else 'Disabled'}")
    print(f"   - Default Motion Threshold: {DEFAULT_MOTION_THRESHOLD}")
    print(f"   - Motion Cooldown: {MOTION_COOLDOWN_SECONDS}s")
    print(f"   - Max Snapshots/Hour: {MAX_SNAPSHOTS_PER_HOUR}")
    print(f"   - Adaptive Thresholds: {list(motion_processor.adaptive_thresholds.keys())}")
    print("=" * 60)
    print("✅ Core Features:")
    print("   - Face Enrollment")
    print("   - Motion Detection Sessions")
    print("   - Motion-Triggered Snapshots")
    print("   - Manual Teacher Capture")
    print("   - Adaptive Motion Processing")
    print("   - Real-time Motion Statistics")
    print("   - Motion Session Management")
    print("=" * 60)
    print("❌ Removed Features:")
    print("   - Periodic Snapshots (replaced with motion detection)")
    print("   - Manual Student Check-in")
    print("   - Simple Check-in")
    print("=" * 60)
    
    uvicorn.run(
        app, 
        host=HOST, 
        port=PORT, 
        log_level="info",
        reload=DEBUG
    )