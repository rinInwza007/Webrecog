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

# Import from layers
from state_module import supabase_manager, cache_manager
from ai_module import (
    FaceEmbeddingProcessor,
    SimilarityCalculator,
    AdvancedFaceEmbeddingManager,
    process_faces_with_advanced_matching
)
from service_module import (
    motion_processor,
    motion_session_manager,
    motion_priority_queue,
    motion_processing_service,
    AttendanceRecordingService
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

# ==================== Helper Functions ====================

async def get_enrolled_students_for_class(class_id: str) -> List[str]:
    """Get enrolled student IDs for a class"""
    try:
        # Try class_students table first
        try:
            result = supabase_manager.get_client().table('class_students').select('user_id')\
                .eq('class_id', class_id).execute()
            
            if result.data:
                student_ids = []
                for record in result.data:
                    try:
                        user_result = supabase_manager.get_client().table('users').select('school_id')\
                            .eq('id', record['user_id']).single().execute()
                        if user_result.data and user_result.data.get('school_id'):
                            student_ids.append(user_result.data['school_id'])
                    except:
                        continue
                
                if student_ids:
                    logger.info(f"✅ Found {len(student_ids)} students for class {class_id}")
                    return student_ids
        except:
            pass
        
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
async def start_motion_detection(request: MotionSessionRequest):
    """Start motion detection session"""
    try:
        session_id = str(uuid.uuid4())
        
        session_config = {
            'class_id': request.class_id,
            'teacher_email': request.teacher_email,
            'motion_threshold': request.motion_threshold,
            'cooldown_seconds': request.cooldown_seconds,
            'on_time_limit_minutes': request.on_time_limit_minutes,
            'max_snapshots_per_hour': MAX_SNAPSHOTS_PER_HOUR,
            'face_threshold': FACE_THRESHOLD
        }
        
        # Create session in service
        motion_session_manager.create_session(session_id, session_config)
        
        # Save to database
        session_data = {
            'id': session_id,
            'class_id': request.class_id,
            'teacher_email': request.teacher_email,
            'start_time': datetime.now().isoformat(),
            'end_time': (datetime.now() + timedelta(hours=request.duration_hours)).isoformat(),
            'on_time_limit_minutes': request.on_time_limit_minutes,
            'status': 'active'
        }
        
        supabase_manager.get_client().table('motion_sessions').insert(session_data).execute()
        
        enrolled_students = await get_enrolled_students_for_class(request.class_id)
        
        return {
            "success": True,
            "session_id": session_id,
            "class_id": request.class_id,
            "teacher_email": request.teacher_email,
            "enrolled_students": enrolled_students,
            "enrolled_count": len(enrolled_students),
            "start_time": datetime.now().isoformat(),
            "motion_settings": {
                "threshold": request.motion_threshold,
                "cooldown_seconds": request.cooldown_seconds,
                "on_time_limit_minutes": request.on_time_limit_minutes
            }
        }
        
    except Exception as e:
        logger.error(f"Error starting motion detection: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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
        session_result = supabase_manager.get_client().table('motion_sessions').select('*')\
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
            'motion_strength': motion_strength,
            'elapsed_minutes': elapsed_minutes,
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
        result = await motion_processing_service.process_motion_capture(processing_item)
        
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
            "processing_time_ms": int(result.get('processing_time', 0) * 1000)
        }
        
    except Exception as e:
        logger.error(f"Error processing motion snapshot: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/face/enroll-advanced")
async def enroll_face_advanced(
    images: List[UploadFile] = File(...),
    student_id: str = Form(...),
    student_email: str = Form(...),
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
                face_locations = FaceEmbeddingProcessor.detect_faces_in_image(image_array, model="cnn")
                
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
            method=enrollment_method
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
        supabase_manager.get_client().table('motion_sessions').update({
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
        # Test basic connectivity
        return {
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "version": "6.0.0-refactored"
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "status": "unhealthy",
            "error": str(e),
            "timestamp": datetime.now().isoformat()
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
            "motion_events": stats['motion_events'],
            "snapshots_taken": stats['snapshots_taken'],
            "attendance_records": stats['attendance_records'],
            "quality_score": stats.get('quality_score', 0.0),
            "latest_timestamp": stats.get('latest_timestamp', datetime.now().isoformat())
        }
        
    except Exception as e:
        logger.error(f"Error getting live motion stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== Real-Time Stream Endpoints ====================

@app.post("/api/realtime/start-stream")
async def start_realtime_stream(
    class_id: str = Form(...),
    teacher_email: str = Form(...),
    on_time_limit_minutes: int = Form(15),
    duration_hours: int = Form(3)
):
    """Start a real-time video stream attendance session"""
    try:
        # Create a motion detection session (same as realtime)
        session_id = str(uuid.uuid4())
        
        # Create session in database
        motion_session_manager.create_session(
            session_id=session_id,
            class_id=class_id,
            teacher_email=teacher_email,
            on_time_limit_minutes=on_time_limit_minutes
        )
        
        # Save to database
        supabase_manager.get_client().table('motion_sessions').insert({
            'id': session_id,
            'class_id': class_id,
            'teacher_email': teacher_email,
            'on_time_limit_minutes': on_time_limit_minutes,
            'duration_hours': duration_hours,
            'status': 'active',
            'session_type': 'realtime_stream',
            'start_time': datetime.now().isoformat(),
            'created_at': datetime.now().isoformat()
        }).execute()
        
        logger.info(f"🎥 Real-time stream session started: {session_id}")
        
        return {
            "success": True,
            "session_id": session_id,
            "class_id": class_id,
            "teacher_email": teacher_email,
            "on_time_limit_minutes": on_time_limit_minutes,
            "duration_hours": duration_hours,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Error starting real-time stream: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/realtime/{session_id}/stop")
async def stop_realtime_stream(session_id: str):
    """Stop a real-time video stream session"""
    try:
        stats = motion_session_manager.get_session_stats(session_id)
        
        if not stats:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Update session in database
        supabase_manager.get_client().table('motion_sessions').update({
            'status': 'ended',
            'end_time': datetime.now().isoformat()
        }).eq('id', session_id).execute()
        
        # Remove from memory
        motion_session_manager.remove_session(session_id)
        
        logger.info(f"🎬 Real-time stream session stopped: {session_id}")
        
        return {
            "success": True,
            "session_id": session_id,
            "total_snapshots": stats['snapshots_taken'],
            "total_attendance_records": stats['attendance_records'],
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Error stopping real-time stream: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/realtime/{session_id}/manual-checkin")
async def realtime_manual_checkin(
    session_id: str,
    student_email: str = Form(...),
    status: str = Form("present")
):
    """Manual check-in for a student in real-time stream"""
    try:
        # Get student name
        student_result = supabase_manager.get_client().table('users')\
            .select('school_id, full_name').eq('email', student_email).execute()
        
        student_name = "Unknown"
        if student_result.data:
            student_name = student_result.data[0].get('full_name', 'Unknown')
        
        # Record attendance
        attendance_record = {
            'session_id': session_id,
            'student_email': student_email,
            'student_id': student_email,
            'attendance_status': status,
            'confidence': 1.0,
            'is_manual': True,
            'capture_time': datetime.now().isoformat(),
            'recorded_at': datetime.now().isoformat()
        }
        
        supabase_manager.get_client().table('attendance_records').insert(
            attendance_record
        ).execute()
        
        logger.info(f"✅ Manual check-in recorded: {student_email} ({status})")
        
        return {
            "success": True,
            "session_id": session_id,
            "student_email": student_email,
            "student_name": student_name,
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
    
    uvicorn.run(app, host=HOST, port=PORT, debug=DEBUG)
