# ==================== Main API Server ====================
# Responsible for: API endpoints, routing, error handling
# Clean FastAPI layer that imports from AI, Logic, and State layers

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import os
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
import io
import json
import numpy as np
from PIL import Image
from dotenv import load_dotenv
import uuid
import asyncio
from datetime import timezone


# Import from layers
from state_module import supabase_manager, cache_manager, embedding_index_manager
from database_view_helper import DatabaseViewHelper
from ai_module import (
    FaceEmbeddingProcessor,
    SimilarityCalculator,
    AdvancedFaceEmbeddingManager,
    process_faces_with_advanced_matching,
    FaceTracker,
    FAISSEmbeddingIndex
)
from service_module import (
    motion_processor,
    motion_session_manager,
    motion_priority_queue,
    motion_processing_service,
    AttendanceRecordingService,
    frame_skipper,
    user_cooldown_manager
)

load_dotenv()

# Configuration
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 8080))
DEBUG = os.getenv("DEBUG", "false").lower() == "true"
FACE_THRESHOLD = float(os.getenv("FACE_VERIFICATION_THRESHOLD", 0.4))
MOTION_DETECTION_ENABLED = os.getenv("MOTION_DETECTION_ENABLED", "true").lower() == "true"
MOTION_COOLDOWN_SECONDS = int(os.getenv("MOTION_COOLDOWN_SECONDS", 30))
MAX_SNAPSHOTS_PER_HOUR = int(os.getenv("MAX_SNAPSHOTS_PER_HOUR", 120))
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logger.info(f"⏱️ MOTION_COOLDOWN_SECONDS = {MOTION_COOLDOWN_SECONDS}")



# Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# FastAPI App
app = FastAPI(
    title="Face Recognition Attendance System",
    description="Motion-triggered face recognition with advanced embeddings",
    version="6.0.0-refactored"
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "https://*.vercel.app",
        "*"
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    allow_origin_regex=r"https://.*\.vercel\.app",
)

# Initialize database view helper
db_view_helper = DatabaseViewHelper(supabase_manager.get_client())

# ==================== Pydantic Models ====================

class StartStreamRequest(BaseModel):
    class_id: str
    teacher_email: str
    on_time_limit_minutes: int = 15
    duration_hours: float = 2

class MotionSessionRequest(BaseModel):
    class_id: str
    teacher_email: str
    duration_hours: float = 2
    motion_threshold: float = 0.1
    cooldown_seconds: int = 30
    on_time_limit_minutes: int = 30

class MotionSnapshotRequest(BaseModel):
    session_id: str
    motion_strength: float
    capture_time: Optional[str] = None
    elapsed_minutes: int = 0

class ManualCheckinRequest(BaseModel):
    student_email: str
    status: str = "present"

# ==================== Helper Functions ====================

async def get_enrolled_students_for_class(class_id: str) -> List[str]:
    """Get enrolled student school_ids for a class (for face recognition)"""
    try:
        # Use optimized view helper for better performance
        students = db_view_helper.get_class_students_enrolled(class_id)
        
        if students:
            school_ids = [s['school_id'] for s in students if s.get('school_id')]
            if school_ids:
                logger.info(f"✅ Found {len(school_ids)} students for class {class_id}")
                return school_ids
        
        # Fallback: use DEBUG mode or manual list
        if DEBUG:
            result = supabase_manager.get_client().table('student_face_embeddings').select('student_id')\
                .eq('is_active', True).execute()
            if result.data:
                return list(set([r['student_id'] for r in result.data]))
        
        manual_students = os.getenv("MANUAL_STUDENTS_FOR_CLASS", "").split(",")
        manual_students = [s.strip() for s in manual_students if s.strip()]
        if manual_students:
            return manual_students
        
        logger.warning(f"No enrolled students found for class {class_id}")
        return []
        
    except Exception as e:
        logger.error(f"Error getting enrolled students: {e}")
        return []
    
@app.on_event("startup")
async def startup_event():
    """Load active sessions from DB on startup"""
    try:
        result = supabase_manager.get_client().table('attendance_sessions')\
            .select('*').eq('status', 'active').execute()
        
        if result.data:
            for session in result.data:
                motion_session_manager.create_session(session['id'], {
                    'class_id': session.get('class_id'),
                    'teacher_email': session.get('teacher_email'),
                    'on_time_limit_minutes': session.get('on_time_limit_minutes', 30),
                    'max_snapshots_per_hour': MAX_SNAPSHOTS_PER_HOUR,
                    'face_threshold': FACE_THRESHOLD
                })
            logger.info(f"✅ Restored {len(result.data)} active sessions from DB")
    except Exception as e:
        logger.warning(f"Could not restore sessions: {e}")
# ==================== API Endpoints ====================

@app.get("/")
async def root():
    """Server status"""
    return {
        "service": "Face Recognition Attendance System",
        "version": "6.0.0-refactored",
        "status": "running",
        "architecture": {
            "ai_layer": "Face detection, embeddings, similarity",
            "logic_layer": "Motion processing, session management",
            "state_layer": "Database, caching"
        },
        "timestamp": datetime.now().isoformat()
    }

@app.post("/api/session/start-motion-detection")
async def start_motion_detection(
    class_id: str = Form(...),
    teacher_email: str = Form(...),
    duration_hours: float = Form(2),
    motion_threshold: float = Form(0.1),
    cooldown_seconds: int = Form(30),
    on_time_limit_minutes: int = Form(30)
):
    """Start motion detection session"""
    try:
        # 1. Fetch limits from classes table
        class_result = supabase_manager.get_client()\
            .table('classes')\
            .select('total_sessions, max_checkins_per_week')\
            .eq('class_id', class_id)\
            .execute()
        
        if class_result.data:
            total_limit = class_result.data[0].get('total_sessions')
            weekly_limit = class_result.data[0].get('max_checkins_per_week')
            
            # 2. Check total session limit
            if total_limit:
                total_sessions_result = supabase_manager.get_client()\
                    .table('attendance_sessions')\
                    .select('id', count='exact')\
                    .eq('class_id', class_id)\
                    .in_('status', ['active', 'ended'])\
                    .execute()
                
                total_count = total_sessions_result.count or 0
                if total_count >= total_limit:
                    raise HTTPException(
                        status_code=400,
                        detail=f"ห้องเรียนนี้สร้างเซสชันครบตามจำนวนที่กำหนดแล้ว ({total_count}/{total_limit})"
                    )
            
            # 3. Check weekly session limit
            if weekly_limit:
                now_utc = datetime.now(timezone.utc)
                week_start = (now_utc - timedelta(days=now_utc.weekday()))\
                    .replace(hour=0, minute=0, second=0, microsecond=0)
                
                weekly_sessions_result = supabase_manager.get_client()\
                    .table('attendance_sessions')\
                    .select('id', count='exact')\
                    .eq('class_id', class_id)\
                    .in_('status', ['active', 'ended'])\
                    .gte('start_time', week_start.isoformat())\
                    .execute()
                
                weekly_count = weekly_sessions_result.count or 0
                if weekly_count >= weekly_limit:
                    raise HTTPException(
                        status_code=400,
                        detail=f"ห้องเรียนนี้สร้างเซสชันเกินขีดจำกัดต่อสัปดาห์แล้ว ({weekly_count}/{weekly_limit})"
                    )

        session_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        
        session_config = {
            'class_id': class_id,
            'teacher_email': teacher_email,
            'motion_threshold': motion_threshold,
            'cooldown_seconds': cooldown_seconds,
            'on_time_limit_minutes': on_time_limit_minutes,
            'max_snapshots_per_hour': MAX_SNAPSHOTS_PER_HOUR,
            'face_threshold': FACE_THRESHOLD
        }
        
        # Create session in service
        motion_session_manager.create_session(session_id, session_config)
        
        # Save to database (with error handling for network issues)
        session_data = {
            'id': session_id,
            'class_id': class_id,
            'teacher_email': teacher_email,
            'start_time': now.isoformat(),
            'end_time': (now + timedelta(hours=duration_hours)).isoformat(),
            'on_time_limit_minutes': on_time_limit_minutes,
            'status': 'active'
        }
        
        db_save_success = False
        try:
            supabase_manager.get_client().table('attendance_sessions').insert(session_data).execute()
            db_save_success = True
            logger.info(f"✅ Motion session saved to database: {session_id}")
        except Exception as db_error:
            # Log the error but don't fail the session creation
            logger.warning(f"⚠️  Database save failed (session still created in-memory): {str(db_error)}")
            if "getaddrinfo failed" in str(db_error) or "Connection" in str(db_error):
                logger.warning("🌐 Network/DNS issue detected - running in offline mode")
        
        enrolled_students = await get_enrolled_students_for_class(class_id)
        
        return {
            "success": True,
            "session_id": session_id,
            "class_id": class_id,
            "teacher_email": teacher_email,
            "enrolled_students": enrolled_students,
            "enrolled_count": len(enrolled_students),
            "start_time": now.isoformat(),
            "motion_settings": {
                "threshold": motion_threshold,
                "cooldown_seconds": cooldown_seconds,
                "on_time_limit_minutes": on_time_limit_minutes
            },
            "database_status": "online" if db_save_success else "offline"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        logger.error(f"❌ Error starting motion detection: {error_msg}")
        
        # Provide helpful error messages
        if "getaddrinfo failed" in error_msg or "Connection" in error_msg:
            raise HTTPException(
                status_code=503,
                detail="Database connection error. Supabase may be unreachable. Check SUPABASE_URL and network connectivity."
            )
        else:
            raise HTTPException(status_code=500, detail=error_msg)

@app.post("/api/motion/snapshot")
async def process_motion_snapshot(
    session_id: str = Form(...),
    motion_strength: float = Form(...),
    elapsed_minutes: int = Form(0),
    image_data: UploadFile = File(...)
):
    """Process motion-triggered snapshot"""
    try:
        capture_time = datetime.now().isoformat()
        
        # Check if snapshot is allowed
        can_capture = motion_session_manager.can_take_snapshot(
            session_id,
            MOTION_COOLDOWN_SECONDS
        )
        
        if not can_capture['allowed']:
            return {
                "success": False,
                "reason": can_capture['reason'],
                "message": f"Snapshot not allowed: {can_capture['reason']}",
                "remaining_seconds": can_capture.get('remaining_seconds')
            }
        
        # Get session config
        session_stats = motion_session_manager.get_session_stats(session_id)
        if not session_stats:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Get session data from DB
        session_result = supabase_manager.get_client().table('attendance_sessions').select('*')\
            .eq('id', session_id).single().execute()
        
        if not session_result.data:
            raise HTTPException(status_code=404, detail="Session not found in database")
        
        session_data = session_result.data
        
        # Determine phase
        phase = motion_processor.get_phase(elapsed_minutes)
        config = motion_processor.get_config(phase)
        
        # Read image
        image_bytes = await image_data.read()
        image_pil = Image.open(io.BytesIO(image_bytes))
        if image_pil.mode != 'RGB':
            image_pil = image_pil.convert('RGB')
        
        # Save motion capture to DB
        capture_log = {
        'session_id': session_id,
        'capture_time': capture_time,
        'capture_type': 'auto',          
        'trigger_type': 'motion',        
        'motion_strength': motion_strength,
        'processing_phase': phase,
        'processing_status': 'processing'
        
        }
        supabase_manager.save_motion_capture(capture_log)
        
        # Process asynchronously
        processing_item = {
            'session_id': session_id,
            'session_data': session_data,
            'config': config,
            'phase': phase,
            'motion_strength': motion_strength,
            'capture_time': capture_time,
            'image_data': image_bytes,
            'priority': motion_processor.calculate_motion_priority(motion_strength, phase),
            'trigger_type': 'motion'
        }
        
        # Start background processing
        result = await motion_processing_service.process_motion_capture(processing_item) #แคปหน้า
        
        # Record motion event
        motion_session_manager.record_motion_event(
            session_id,
            motion_strength,
            snapshot_taken=True
        )
        
        return {
            "success": result['success'],
            "session_id": session_id,
            "capture_time": capture_time,
            "phase": phase,
            "motion_strength": motion_strength,
            "new_records": result.get('new_records', 0),
            "faces_detected": result.get('faces_detected', 0),
            "processing_time_ms": int(result.get('processing_time', 0) * 1000),
            "already_checked": result.get('already_checked', 0),
            "unrecognized": result.get('unrecognized', 0),

            # Spoof detection results
            "spoof_detected": result.get('spoof_detected', False),
            "spoof_count": result.get('spoof_count', 0),
            "spoof_timestamp": result.get('spoof_timestamp'),
            "spoof_image_b64": result.get('spoof_image_b64')    
        }
        
    except Exception as e:
        logger.error(f"Error processing motion snapshot: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/motion/manual-capture")
async def manual_capture_motion(
    session_id: str = Form(...),
    image: UploadFile = File(...)  # ← เปลี่ยนชื่อจาก image_data เป็น image
):
    try:
        session_stats = motion_session_manager.get_session_stats(session_id)
        if not session_stats:
            raise HTTPException(status_code=404, detail="Session not found")

        session_result = supabase_manager.get_client().table('attendance_sessions')\
            .select('*').eq('id', session_id).single().execute()
        if not session_result.data:
            raise HTTPException(status_code=404, detail="Session not found in database")

        session_data = session_result.data
        phase = motion_processor.get_phase(0)
        config = motion_processor.get_config(phase)
        capture_time = datetime.now().isoformat()

        image_bytes = await image.read()

        processing_item = {
            'session_id': session_id,
            'session_data': session_data,
            'config': config,
            'phase': phase,
            'motion_strength': 1.0,  # manual = force capture
            'capture_time': capture_time,
            'image_data': image_bytes,
            'priority': 1,
            'trigger_type': 'manual'
        }

        result = await motion_processing_service.process_motion_capture(processing_item)

        return {
            "success": result['success'],
            "session_id": session_id,
            "faces_detected": result.get('faces_detected', 0),
            "new_records": result.get('new_records', 0),
            "already_checked": result.get('already_checked', 0),
            "unrecognized": result.get('unrecognized', 0),


            "spoof_detected": result.get('spoof_detected', False),
            "spoof_count": result.get('spoof_count', 0),
            "spoof_timestamp": result.get('spoof_timestamp'),
            "spoof_image_b64": result.get('spoof_image_b64')
        }

    except Exception as e:
        logger.error(f"Error in manual capture: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/face/enroll-advanced")
async def enroll_face_advanced(
    images: List[UploadFile] = File(...),
    student_id: str = Form(...),
    student_email: str = Form(...),
    student_name: str = Form(''),           
    poses: List[str] = Form(None),          
    enrollment_method: str = Form('weighted_centroid'),
    min_quality_threshold: float = Form(0.3)
):
    """Advanced face enrollment with multiple image processing"""
    try:
        if not images or len(images) == 0:
            raise HTTPException(status_code=400, detail="At least one image required")
        
        if len(images) > 10:
            raise HTTPException(status_code=400, detail="Maximum 10 images allowed")
        
        logger.info(f"🎯 Advanced enrollment for {student_id} ({len(images)} images, method: {enrollment_method})")
        
        embedding_manager = AdvancedFaceEmbeddingManager(supabase_manager, cache_manager)
        all_encodings = []
        quality_scores = []
        image_analysis = []
        
        for idx, image_file in enumerate(images):
            try:
                image_data = await image_file.read()
                image = Image.open(io.BytesIO(image_data))
                
                if image.mode != 'RGB':
                    image = image.convert('RGB')
                
                image_array = np.array(image)
                
                # Detect faces
                face_locations, _ = FaceEmbeddingProcessor.detect_faces_in_image(image_array, model="hog")
                
                if not face_locations:
                    image_analysis.append({'index': idx+1, 'status': 'no_face'})
                    continue
                
                if len(face_locations) > 1:
                    face_locations = sorted(face_locations, 
                                          key=lambda loc: (loc[2]-loc[0])*(loc[1]-loc[3]), 
                                          reverse=True)
                
                # Extract encodings with high quality
                encodings = FaceEmbeddingProcessor.extract_face_encodings(
                    image_array, face_locations[:1], num_jitters=3
                )
                
                if not encodings:
                    image_analysis.append({'index': idx+1, 'status': 'no_encoding'})
                    continue
                
                raw_encoding = encodings[0]
                norm_encoding = FaceEmbeddingProcessor.normalize_embedding(raw_encoding)
                
                if norm_encoding is None:
                    image_analysis.append({'index': idx+1, 'status': 'normalization_failed'})
                    continue
                
                # Calculate quality
                quality_info = FaceEmbeddingProcessor.calculate_face_quality(image_array, face_locations[0])
                quality_score = quality_info['overall_score']
                
                if quality_score >= min_quality_threshold:
                    all_encodings.append(norm_encoding)
                    quality_scores.append(quality_score)
                    image_analysis.append({
                        'index': idx+1,
                        'status': 'success',
                        'quality_score': quality_score,
                        'quality_details': quality_info
                    })
                    logger.info(f"✅ Image {idx+1} enrolled (quality: {quality_score:.3f})")
                else:
                    image_analysis.append({
                        'index': idx+1,
                        'status': 'low_quality',
                        'quality_score': quality_score,
                        'threshold': min_quality_threshold
                    })
                
            except Exception as e:
                logger.error(f"Error processing image {idx+1}: {e}")
                image_analysis.append({'index': idx+1, 'status': 'error', 'reason': str(e)})
                continue
        
        if not all_encodings:
            raise HTTPException(status_code=400, detail="No valid face encodings generated")
        
        # Save embeddings
        success = embedding_manager.save_multiple_embeddings(
            student_id,
            all_encodings,
            quality_scores,
            method=enrollment_method,
            poses=poses or ['front', 'left', 'right']
        )
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to save embeddings")
        
        # Clear cache
        cache_manager.invalidate_student_cache(student_id)
        
        success_count = len(all_encodings)
        avg_quality = float(np.mean(quality_scores))
        
        logger.info(f"✅ Advanced enrollment complete: {success_count} images, avg quality: {avg_quality:.3f}")
        
        return {
            "success": True,
            "student_id": student_id,
            "images_processed": len(images),
            "successful_encodings": success_count,
            "enrollment_method": enrollment_method,
            "quality_statistics": {
                "average_quality": avg_quality,
                "quality_std": float(np.std(quality_scores)) if quality_scores else 0,
                "min_quality": float(min(quality_scores)) if quality_scores else 0,
                "max_quality": float(max(quality_scores)) if quality_scores else 0
            },
            "image_analysis": image_analysis,
            "timestamp": datetime.now().isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Advanced enrollment error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/debug/test-advanced-recognition")
async def test_advanced_recognition(
    image: UploadFile = File(...),
    class_id: str = Form(...),
    use_advanced_similarity: bool = Form(True),
    custom_threshold: float = Form(None)
):
    """Test face recognition with detailed analysis"""
    try:
        # Process image
        image_data = await image.read()
        image_pil = Image.open(io.BytesIO(image_data))
        if image_pil.mode != 'RGB':
            image_pil = image_pil.convert('RGB')
        
        image_array = np.array(image_pil)
        
        # Get enrolled students
        enrolled_students = await get_enrolled_students_for_class(class_id)
        
        if not enrolled_students:
            return {
                "success": False,
                "message": "No enrolled students found",
                "class_id": class_id
            }
        
        # Create config
        config = {
            'face_threshold': custom_threshold if custom_threshold else FACE_THRESHOLD,
            'enable_quality_check': True
        }
        
        # Initialize embedding manager
        embedding_manager = AdvancedFaceEmbeddingManager(supabase_manager, cache_manager)
        
        # Process faces
        detected_faces = process_faces_with_advanced_matching(
            "debug",
            image_array,
            enrolled_students,
            config,
            motion_strength=0.5,
            embedding_manager=embedding_manager,
            use_advanced_similarity=use_advanced_similarity
        )
        
        recognized_count = len([f for f in detected_faces if f['verified']])
        
        return {
            "success": True,
            "class_id": class_id,
            "enrolled_students": enrolled_students,
            "faces_detected": len(detected_faces),
            "faces_recognized": recognized_count,
            "threshold_used": config['face_threshold'],
            "detailed_results": detected_faces,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Error in recognition test: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/session/{session_id}/motion-statistics")
async def get_motion_statistics(session_id: str):
    """Get motion session statistics"""
    try:
        stats = motion_session_manager.get_session_stats(session_id)
        
        if not stats:
            raise HTTPException(status_code=404, detail="Session not found")
        
        return {
            "success": True,
            "session_id": session_id,
            "motion_events": stats['motion_events'],
            "snapshots_taken": stats['snapshots_taken'],
            "last_snapshot": stats.get('last_snapshot'),
            "motion_history_count": len(stats['motion_history']),
            "hourly_distribution": stats['hourly_events'],
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Error getting motion statistics: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/session/{session_id}/end-motion")
async def end_motion_session(session_id: str):
    """End motion detection session"""
    try:
        stats = motion_session_manager.get_session_stats(session_id)
        
        if not stats:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Update session in database
        supabase_manager.get_client().table('attendance_sessions').update({
            'status': 'ended',
            'end_time': datetime.now().isoformat()
        }).eq('id', session_id).execute()
        
        # Remove session from memory
        motion_session_manager.remove_session(session_id)
        
        logger.info(f"📱 Motion session ended: {session_id}")
        
        return {
            "success": True,
            "session_id": session_id,
            "final_statistics": {
                "total_motion_events": stats['motion_events'],
                "total_snapshots": stats['snapshots_taken'],
                "efficiency": stats['snapshots_taken'] / stats['motion_events'] if stats['motion_events'] > 0 else 0
            },
            "ended_at": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Error ending motion session: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
@app.put("/api/session/{session_id}/end")
async def end_session(session_id: str):
    """End session (alias for end-motion)"""
    return await end_motion_session(session_id)

@app.get("/api/system/advanced-status")
async def get_system_status():
    """Get comprehensive system status"""
    try:
        return {
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "version": "6.0.0-refactored",
            "architecture": {
                "ai_layer": "Face detection, embeddings, similarity calculations",
                "logic_layer": "Motion processing, session management, attendance recording",
                "state_layer": "Supabase, in-memory caching"
            },
            "configuration": {
                "face_threshold": FACE_THRESHOLD,
                "motion_enabled": MOTION_DETECTION_ENABLED,
                "motion_cooldown_seconds": MOTION_COOLDOWN_SECONDS,
                "max_snapshots_per_hour": MAX_SNAPSHOTS_PER_HOUR
            },
            "features": {
                "normalized_embeddings": True,
                "multi_similarity_metrics": True,
                "ensemble_embeddings": True,
                "quality_filtering": True,
                "confidence_levels": True,
                "adaptive_thresholds": True,
                "motion_detection": MOTION_DETECTION_ENABLED
            },
            "status": "running"
        }
        
    except Exception as e:
        logger.error(f"Error getting system status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== Health Check ====================

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        # Check if running in offline mode
        database_status = "offline" if supabase_manager.is_offline_mode() else "online"
        
        return {
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "version": "6.0.0-refactored",
            "database_status": database_status,
            "mode": "offline (in-memory)" if database_status == "offline" else "online (Supabase)"
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "status": "unhealthy",
            "error": str(e),
            "timestamp": datetime.now().isoformat(),
            "database_status": "unknown"
        }

# ==================== Motion Session Live Stats Alias ====================

@app.get("/api/motion/session/{session_id}/live-stats")
async def get_motion_session_live_stats(session_id: str):
    """Get live motion statistics for a session (alias for motion-statistics)"""
    try:
        stats = motion_session_manager.get_session_stats(session_id)
        
        if not stats:
            raise HTTPException(status_code=404, detail="Session not found")
        
        logger.info(f"📊 Live stats retrieved for session: {session_id}")
        
        return {
            "success": True,
            "session_id": session_id,
            "session_type": "motion_detection",
            "motion_events": stats.get('motion_events', 0),        # เปลี่ยน
            "snapshots_taken": stats.get('snapshots_taken', 0),    # เปลี่ยน
            "attendance_records": stats.get('attendance_records', 0),  # เปลี่ยน
            "quality_score": stats.get('quality_score', 0.0),      # เปลี่ยน
            "latest_timestamp": stats.get('latest_timestamp', datetime.now().isoformat())  # เปลี่ยน
        }
        
    except Exception as e:
        logger.error(f"Error getting live motion stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== Real-Time Stream Endpoints (Aliases for TS Compatibility) ====================

@app.post("/api/realtime/start-stream")
async def start_realtime_stream(
    class_id: str = Form(...),
    teacher_email: str = Form(...),
    on_time_limit_minutes: int = Form(15),
    duration_hours: float = Form(2)
):
    """Alias for start_motion_session to match TypeScript interface"""
    return await start_motion_session(
        class_id=class_id,
        teacher_email=teacher_email,
        on_time_limit_minutes=on_time_limit_minutes,
        duration_hours=duration_hours
    )

@app.post("/api/realtime/{session_id}/manual-checkin")
async def realtime_manual_checkin(
    session_id: str,
    student_email: str = Form(...),
    status: str = Form("present")
):
    """Alias for motion_manual_checkin to match TypeScript interface"""
    return await motion_manual_checkin(session_id, student_email, status)

@app.put("/api/realtime/{session_id}/stop")
async def realtime_stop_session(session_id: str):
    """Alias for stop_motion_session to match TypeScript interface"""
    return await stop_motion_session(session_id)

@app.get("/api/session/{session_id}/attendance")
async def get_session_attendance(session_id: str):
    """Get all attendance records for a session to match TypeScript AttendanceListResponse"""
    try:
        result = supabase_manager.get_client().table('attendance_records')\
            .select('*').eq('session_id', session_id).execute()
        
        return {
            "success": True,
            "data": result.data or []
        }
    except Exception as e:
        logger.error(f"Error fetching attendance: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== Real-Time Stream Endpoints ====================

@app.post("/api/motion/start-session")
async def start_motion_session(
    class_id: str = Form(...),
    teacher_email: str = Form(...),
    on_time_limit_minutes: int = Form(15),
    duration_hours: float  = Form(3)    
):
    """Start a motion detection session"""
    try:
        # 1. Fetch limits from classes table
        class_result = supabase_manager.get_client()\
            .table('classes')\
            .select('total_sessions, max_checkins_per_week, subject_name')\
            .eq('class_id', class_id)\
            .execute()
        
        if class_result.data:
            total_limit = class_result.data[0].get('total_sessions')
            weekly_limit = class_result.data[0].get('max_checkins_per_week')
            
            # 2. Check total session limit
            if total_limit:
                total_sessions_result = supabase_manager.get_client()\
                    .table('attendance_sessions')\
                    .select('id', count='exact')\
                    .eq('class_id', class_id)\
                    .in_('status', ['active', 'ended'])\
                    .execute()
                
                total_count = total_sessions_result.count or 0
                if total_count >= total_limit:
                    raise HTTPException(
                        status_code=400,
                        detail=f"ห้องเรียนนี้สร้างเซสชันครบตามจำนวนที่กำหนดแล้ว ({total_count}/{total_limit})"
                    )
            
            # 3. Check weekly session limit
            if weekly_limit:
                now_utc = datetime.now(timezone.utc)
                week_start = (now_utc - timedelta(days=now_utc.weekday()))\
                    .replace(hour=0, minute=0, second=0, microsecond=0)
                
                weekly_sessions_result = supabase_manager.get_client()\
                    .table('attendance_sessions')\
                    .select('id', count='exact')\
                    .eq('class_id', class_id)\
                    .in_('status', ['active', 'ended'])\
                    .gte('start_time', week_start.isoformat())\
                    .execute()
                
                weekly_count = weekly_sessions_result.count or 0
                if weekly_count >= weekly_limit:
                    raise HTTPException(
                        status_code=400,
                        detail=f"ห้องเรียนนี้สร้างเซสชันเกินขีดจำกัดต่อสัปดาห์แล้ว ({weekly_count}/{weekly_limit})"
                    )

        # Create a motion detection session (same as realtime)
        session_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        
        # Create session in memory
        motion_session_manager.create_session(
            session_id=session_id,
            class_id=class_id,
            teacher_email=teacher_email,
            on_time_limit_minutes=on_time_limit_minutes
        )

        # Save to database
        supabase_manager.get_client().table('attendance_sessions').insert({
            'id': session_id,
            'class_id': class_id,
            'teacher_email': teacher_email,
            'on_time_limit_minutes': on_time_limit_minutes,
            'duration_hours': duration_hours,
            'status': 'active',
            'session_type': 'motion_detection',
            'start_time': now.isoformat(),
            'created_at': now.isoformat()
        }).execute()
        
        return {
            "success": True,
            "session_id": session_id,
            "class_id": class_id,
            "teacher_email": teacher_email,
            "on_time_limit_minutes": on_time_limit_minutes,
            "duration_hours": duration_hours,
            "timestamp": now.isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting motion detection session: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/motion/{session_id}/stop")
async def stop_motion_session(session_id: str):
    """Stop a motion detection session"""
    try:
        stats = motion_session_manager.get_session_stats(session_id)
        
        if not stats:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Update session in database
        supabase_manager.get_client().table('attendance_sessions').update({
            'status': 'ended',
            'end_time': datetime.now().isoformat()
        }).eq('id', session_id).execute()
        
        # Remove from memory
        motion_session_manager.remove_session(session_id)
        
        logger.info(f"🎬 Motion detection session stopped: {session_id}")
        
        return {
            "success": True,
            "session_id": session_id,
            "total_snapshots": stats.get('snapshots_taken', 0),
            "total_attendance_records": stats.get('attendance_records', 0),  # เปลี่ยน
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Error stopping motion detection session: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/motion/{session_id}/manual-checkin")
async def motion_manual_checkin(
    session_id: str,
    student_email: str = Form(...),
    status: str = Form("present")
):
    try:
        # 🔍 Query user
        student_result = supabase_manager.get_client().table('users')\
            .select('school_id, full_name, email')\
            .eq('email', student_email)\
            .execute()
        
        if not student_result.data:
            raise HTTPException(status_code=404, detail="Student not found")

        user_data = student_result.data[0]
        student_id = user_data['school_id']   # ✅ ตัวจริง
        student_name = user_data.get('full_name', 'Unknown')
        student_email = user_data['email']    # ✅ fix ให้ชัด

        # 📝 Record attendance
        attendance_record = {
            'session_id': session_id,
            'student_email': student_email,
            'student_id': student_id,
            'check_in_time': datetime.now().isoformat(),
            'status': status,
            'face_match_score': 1.0,
            'detection_method': 'manual',
            'processing_phase': 'realtime',
            'face_quality': 1.0,
            'motion_strength': 0.0,
            'trigger_type': 'manual'
        }

        supabase_manager.get_client().table('attendance_records')\
            .insert(attendance_record)\
            .execute()

        logger.info(f"✅ Manual check-in recorded: {student_email} ({status})")

        return {
            "success": True,
            "session_id": session_id,
            "student_email": student_email,
            "student_name": student_name,
            "student_id": student_id,
            "status": status,
            "timestamp": datetime.now().isoformat()
        }

    except Exception as e:
        logger.error(f"Error recording manual check-in: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== Server Startup ====================

if __name__ == "__main__":
    import uvicorn
    
    logger.info(f"🚀 Starting Face Recognition Server v6.0.0-refactored")
    logger.info(f"📐 Architecture: AI Layer | Logic Layer | State Layer")
    logger.info(f"📍 Host: {HOST}, Port: {PORT}")
    
    if DEBUG:
        # reload mode ต้องใช้ import string
        uvicorn.run(
            "main_refactored:app",
            host=HOST,
            port=PORT,
            reload=True
        )
    else:
        # production mode ใช้ app object ได้เลย
        uvicorn.run(
            app,
            host=HOST,
            port=PORT
        )