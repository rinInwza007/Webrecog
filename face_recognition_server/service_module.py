# ==================== Logic Layer ====================
# Responsible for: Business logic, Motion processing, Session management, Orchestration
# Dependencies: State layer, AI layer

import logging
import threading
import time
import heapq
import asyncio
import json
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
import numpy as np

from state_module import supabase_manager, cache_manager
from ai_module import process_faces_with_advanced_matching, AdvancedFaceEmbeddingManager

logger = logging.getLogger(__name__)


class FrameSkippingManager:
    """Intelligent frame skipping to optimize processing"""
    
    def __init__(self):
        self.frame_counter = 0
        self.skip_pattern = {
            'high_motion': 1,      # Process every frame
            'medium_motion': 2,    # Process every 2nd frame
            'low_motion': 4,       # Process every 4th frame
            'stable': 6            # Process every 6th frame
        }
        self.lock = threading.Lock()
    
    def should_process_frame(self, motion_strength: float, processing_time_ms: float) -> bool:
        """Determine if frame should be processed based on motion and load"""
        with self.lock:
            self.frame_counter += 1
            
            # Adaptive skipping based on motion strength and processing time
            if motion_strength > 0.7:
                skip_interval = self.skip_pattern['high_motion']
            elif motion_strength > 0.4:
                skip_interval = self.skip_pattern['medium_motion']
            elif motion_strength > 0.2:
                skip_interval = self.skip_pattern['low_motion']
            else:
                skip_interval = self.skip_pattern['stable']
            
            # Increase skipping if system is overloaded
            if processing_time_ms > 500:  # 500ms is high load
                skip_interval = min(skip_interval * 2, 8)
                logger.debug(f"⚠️  High load detected ({processing_time_ms}ms), increasing skip interval to {skip_interval}")
            
            should_process = (self.frame_counter % skip_interval) == 0
            
            if should_process:
                logger.debug(f"✅ Processing frame #{self.frame_counter} (skip={skip_interval})")
            else:
                logger.debug(f"⏭️  Skipping frame #{self.frame_counter}")
            
            return should_process
    
    def reset(self):
        """Reset counter"""
        with self.lock:
            self.frame_counter = 0


class PerUserCooldownManager:
    """Manage per-student attendance cooldown to prevent duplicate records"""
    
    def __init__(self):
        self.user_cooldowns = {}  # {'student_id': last_record_time}
        self.default_cooldown_minutes = 5
        self.lock = threading.Lock()
    
    def can_record_attendance(self, student_id: str, cooldown_minutes: int = None) -> bool:
        """Check if student can have attendance recorded"""
        with self.lock:
            if cooldown_minutes is None:
                cooldown_minutes = self.default_cooldown_minutes
            
            if student_id not in self.user_cooldowns:
                self.user_cooldowns[student_id] = datetime.now()
                logger.info(f"👤 New student tracked: {student_id}")
                return True
            
            last_record = self.user_cooldowns[student_id]
            elapsed = (datetime.now() - last_record).total_seconds() / 60
            
            if elapsed >= cooldown_minutes:
                self.user_cooldowns[student_id] = datetime.now()
                logger.info(f"✅ Cooldown expired for {student_id} ({elapsed:.1f}min elapsed)")
                return True
            else:
                logger.debug(f"⏸️  Cooldown active for {student_id} ({cooldown_minutes - elapsed:.1f}min remaining)")
                return False
    
    def reset_user(self, student_id: str):
        """Reset cooldown for specific user"""
        with self.lock:
            if student_id in self.user_cooldowns:
                del self.user_cooldowns[student_id]
                logger.debug(f"🔄 Cooldown reset for {student_id}")
    
    def get_remaining_cooldown(self, student_id: str, cooldown_minutes: int = None) -> float:
        """Get remaining cooldown time in minutes"""
        with self.lock:
            if cooldown_minutes is None:
                cooldown_minutes = self.default_cooldown_minutes
            
            if student_id not in self.user_cooldowns:
                return 0
            
            last_record = self.user_cooldowns[student_id]
            elapsed = (datetime.now() - last_record).total_seconds() / 60
            remaining = max(0, cooldown_minutes - elapsed)
            
            return remaining
    
    def clear_all(self):
        """Clear all cooldowns"""
        with self.lock:
            self.user_cooldowns.clear()
            logger.info("🗑️  All user cooldowns cleared")


class MotionDetectionProcessor:
    """Handle adaptive motion threshold and processing configuration"""
    
    def __init__(self):
        self.adaptive_thresholds = {
            '0-10': 0.05,
            '10-30': 0.08,
            '30-60': 0.12,
            '60-90': 0.15,
            '90+': 0.20
        }
        
        self.processing_configs = {
            '0-10': {
                'face_threshold': 0.75,
                'model_accuracy': 'high',
                'processing_priority': 1,
                'max_processing_time': 3,
                'enable_quality_check': True,
                'motion_boost': True
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
        adaptive = self.adaptive_thresholds.get(phase, 0.2)
        if base_threshold:
            return (adaptive + base_threshold) / 2
        return adaptive
    
    def get_config(self, phase: str) -> Dict:
        """Get processing configuration for phase"""
        return self.processing_configs.get(phase, self.processing_configs['30-60'])
    
    def calculate_motion_priority(self, motion_strength: float, phase: str) -> int:
        """Calculate processing priority based on motion strength and phase"""
        base_config = self.get_config(phase)
        base_priority = base_config['processing_priority']
        
        if motion_strength > 0.5:
            return max(1, base_priority - 2)
        elif motion_strength > 0.3:
            return max(1, base_priority - 1)
        elif motion_strength > 0.15:
            return base_priority
        else:
            return min(5, base_priority + 1)


class MotionSessionManager:
    """Manage motion detection sessions and statistics"""
    
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
                    'attendance_records': 0,
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
            
            if hour_key not in session['stats']['hourly_events']:
                session['stats']['hourly_events'][hour_key] = 0
            session['stats']['hourly_events'][hour_key] += 1
            
            session['stats']['motion_history'].append({
                'timestamp': now.isoformat(),
                'strength': motion_strength,
                'snapshot_taken': snapshot_taken
            })
            
            if len(session['stats']['motion_history']) > 100:
                session['stats']['motion_history'] = session['stats']['motion_history'][-100:]
            
            return True
    
    def can_take_snapshot(self, session_id: str, cooldown_seconds: int = 30) -> Dict[str, Any]:
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
                
                if time_since_last < cooldown_seconds:
                    return {
                        'allowed': False,
                        'reason': 'cooldown_active',
                        'remaining_seconds': int(cooldown_seconds - time_since_last)
                    }
            
            # Check hourly rate limit
            current_hour = now.strftime('%H:00')
            hourly_count = stats['hourly_events'].get(current_hour, 0)
            max_per_hour = session['config'].get('max_snapshots_per_hour', 120)
            
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


class MotionPriorityQueue:
    """Priority queue for motion processing"""
    
    def __init__(self):
        self.queue = []
        self.index = 0
        self.lock = asyncio.Lock()
    
    async def put(self, item):
        """Add item to queue with priority"""
        async with self.lock:
            priority = item['priority']
            if item.get('trigger_type') == 'motion':
                priority = max(1, priority - 0.5)
            
            heapq.heappush(self.queue, (priority, self.index, item))
            self.index += 1
    
    async def get(self):
        """Get highest priority item"""
        async with self.lock:
            if self.queue:
                priority, index, item = heapq.heappop(self.queue)
                return item
            return None
    
    def qsize(self):
        """Get queue size"""
        return len(self.queue)


class AttendanceRecordingService:
    """Handle attendance recording logic"""
    
    def __init__(self, supabase_mgr=None, state_mgr=None):
        self.supabase_mgr = supabase_mgr or supabase_manager
        self.state_mgr = state_mgr or supabase_manager

    # ──────────────────────────────────────────────────────────────────────────
    # Helpers
    # ──────────────────────────────────────────────────────────────────────────

    def _get_session_ids_for_class(self, class_id: str) -> List[str]:
        """Get all session IDs (active + ended) for a class"""
        result = self.supabase_mgr.get_client()\
            .table('attendance_sessions')\
            .select('id')\
            .eq('class_id', class_id)\
            .execute()
        return [r['id'] for r in (result.data or [])]

    def _check_weekly_limit(
    self, student_email: str, class_id: str
) -> Dict[str, Any]:
    
        try:
            # ดึง max_checkins_per_week ของ class
            class_result = self.supabase_mgr.get_client()\
                .table('classes')\
                .select('max_checkins_per_week')\
                .eq('class_id', class_id)\
                .execute()

            if not class_result.data:
                return {'allowed': True, 'reason': None,
                        'weekly_session_count': 0, 'max_per_week': None}

            max_per_week = class_result.data[0].get('max_checkins_per_week')

            # ไม่ได้ตั้งค่า limit → ผ่านเลย
            if not max_per_week:
                return {'allowed': True, 'reason': None,
                        'weekly_session_count': 0, 'max_per_week': None}

            # หาวันจันทร์ต้นสัปดาห์ (UTC)
            from datetime import timezone
            now = datetime.now(timezone.utc)
            week_start = (now - timedelta(days=now.weekday()))\
                .replace(hour=0, minute=0, second=0, microsecond=0)

            # นับจำนวน session ของ class นี้ที่เริ่มในสัปดาห์ปัจจุบัน
            # (นับระดับ session ไม่ใช่ระดับ attendance record)
            session_result = self.supabase_mgr.get_client()\
                .table('attendance_sessions')\
                .select('id', count='exact')\
                .eq('class_id', class_id)\
                .gte('start_time', week_start.isoformat())\
                .execute()

            weekly_session_count = session_result.count or 0

            if weekly_session_count >= max_per_week:
                return {
                    'allowed': False,
                    'reason': (
                        f'weekly_session_limit_reached '
                        f'({weekly_session_count}/{max_per_week} sessions this week)'
                    ),
                    'weekly_session_count': weekly_session_count,
                    'max_per_week': max_per_week
                }

            return {
                'allowed': True,
                'reason': None,
                'weekly_session_count': weekly_session_count,
                'max_per_week': max_per_week
            }

        except Exception as e:
            logger.error(f"Error checking weekly session limit for class {class_id}: {e}")
            # fail-open: ถ้า query พัง ให้ผ่านไปก่อนเพื่อไม่ block attendance
            return {'allowed': True, 'reason': None,
                    'weekly_session_count': 0, 'max_per_week': None}

    # ──────────────────────────────────────────────────────────────────────────
    # Main record method
    # ──────────────────────────────────────────────────────────────────────────

    async def record_attendance_from_face(
        self, face_info: Dict, session_id: str,
        session_data: Dict, capture_time: str,
        motion_strength: float = 0.5, phase: str = '0-10'
    ) -> bool:
        """Record attendance for a recognized face"""
        try:
            if not face_info.get('verified'):
                return False
            
            student_id = face_info['student_id']
            confidence = face_info['confidence']
            
            # Get student email
            user_result = self.supabase_mgr.get_client().table('users')\
                .select('email')\
                .eq('school_id', student_id)\
                .execute()
            
            if not user_result.data:
                logger.warning(f"No user found for school_id: {student_id}")
                return False
            
            student_email = user_result.data[0]['email']
            
            # ── Check duplicate ───────────────────────────────────────────────
            if self.supabase_mgr.check_attendance_exists(session_id, student_email):
                logger.info(f"Student {student_id} already recorded in this session, skipping")
                return False

            # ── Check weekly limit ────────────────────────────────────────────
            class_id = session_data.get('class_id')
            if class_id:
                weekly_check = self._check_weekly_limit(student_email, class_id)
                if not weekly_check['allowed']:
                    logger.warning(
                        f"⛔ Weekly limit blocked {student_id} "
                        f"({student_email}): {weekly_check['reason']}"
                    )
                    return False
                elif weekly_check['max_per_week']:
                    logger.info(
                        f"📊 Weekly usage for {student_id}: "
                        f"{weekly_check['weekly_session_count'] + 1}/{weekly_check['max_per_week']}"
                    )
            # ─────────────────────────────────────────────────────────────────

            # ── Timezone helper ───────────────────────────────────────────────
            def to_aware(dt_str: str) -> datetime:
                """Parse datetime string และ force UTC ถ้าเป็น naive"""
                from datetime import timezone
                if not dt_str:
                    return datetime.now(timezone.utc)
                dt_str = dt_str.strip().replace('Z', '+00:00').replace(' ', 'T')
                try:
                    dt = datetime.fromisoformat(dt_str)
                except ValueError:
                    dt = datetime.strptime(dt_str[:19], '%Y-%m-%dT%H:%M:%S')
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt
            # ─────────────────────────────────────────────────────────────────

            capture_dt    = to_aware(capture_time)
            session_start = to_aware(session_data['start_time'])
            on_time_limit = session_start + timedelta(
                minutes=session_data.get('on_time_limit_minutes', 30)
            )

            logger.debug(
                f"⏱️  capture_dt={capture_dt} | "
                f"session_start={session_start} | "
                f"on_time_limit={on_time_limit}"
            )

            status = 'present' if capture_dt <= on_time_limit else 'late'
            
            # Prepare record
            record_data = {
                'session_id':        session_id,
                'student_email':     student_email,
                'student_id':        student_id,
                'check_in_time':     capture_dt.isoformat(),
                'status':            status,
                'face_match_score':  round(float(confidence), 3),
                'detection_method':  'advanced_motion_triggered',
                'processing_phase':  phase,
                'face_quality':      round(float(face_info.get('quality_score', 1.0)), 2),
                'motion_strength':   round(float(motion_strength), 3),
                'trigger_type':      'motion',
            }
            
            # Save to database
            success = self.supabase_mgr.save_attendance_record(record_data)
            
            if success:
                logger.info(
                    f"✅ Attendance recorded: {student_id} ({student_email}) "
                    f"status={status} phase={phase}"
                )
            else:
                logger.error(
                    f"❌ save_attendance_record returned False for {student_id}"
                )
            
            return success
            
        except Exception as e:
            logger.error(
                f"❌ Error saving attendance for {face_info.get('student_id')}: {e}",
                exc_info=True
            )
            return False


class MotionProcessingService:
    """Orchestrate motion capture processing"""
    
    def __init__(self, supabase_mgr=None):
        self.supabase_mgr = supabase_mgr or supabase_manager
        self.embedding_manager = AdvancedFaceEmbeddingManager(self.supabase_mgr, cache_manager)
        self.attendance_service = AttendanceRecordingService(self.supabase_mgr)
    
    async def get_enrolled_students_for_class(self, class_id: str) -> List[str]:
        """Get enrolled student IDs for a class"""
        return self.supabase_mgr.get_enrolled_students_for_class(class_id)
     
    async def process_motion_capture(self, item: Dict) -> Dict[str, Any]:
        """Process motion-triggered snapshot"""
        try:
            start_time = time.time()
            session_id = item['session_id']
            session_data = item['session_data']
            config = item['config']
            phase = item['phase']
            motion_strength = item['motion_strength']
            
            logger.info(f"🚶 Motion processing: {session_id} (phase: {phase}, strength: {motion_strength:.3f})")
            
            from PIL import Image
            import io
            import numpy as np
            
            image_pil = Image.open(io.BytesIO(item['image_data']))
            if image_pil.mode != 'RGB':
                image_pil = image_pil.convert('RGB')
            
            image_array = np.array(image_pil)
            
            # Get enrolled students
            enrolled_students = await self.get_enrolled_students_for_class(session_data['class_id'])
            
            if not enrolled_students:
                logger.warning(f"No enrolled students for motion capture: {session_id}")
                return {'success': False, 'reason': 'no_students', 'new_records': 0}
            
            # Process faces with advanced matching
            result_matching = process_faces_with_advanced_matching(
                session_id,
                image_array,
                enrolled_students,
                config,
                motion_strength,
                self.embedding_manager,
                use_advanced_similarity=True
            )
            
            # Record attendance
            detected_faces = result_matching['detected_faces']
            spoof_count = result_matching.get('spoof_count', 0)
            spoof_timestamp = result_matching.get('spoof_timestamp')
            spoof_image_b64 = result_matching.get('spoof_image_b64')

            new_records = 0
            already_checked = 0
            unrecognized = 0

            for face_info in detected_faces:
                if not face_info.get('verified'):
                    unrecognized += 1
                    continue
                success = await self.attendance_service.record_attendance_from_face(
                    face_info, session_id, session_data, item['capture_time'],
                    motion_strength, phase
                )
                if success:
                    new_records += 1
                else:
                    already_checked += 1

            if new_records > 0:
                with motion_session_manager.lock:
                    if session_id in motion_session_manager.sessions:
                        motion_session_manager.sessions[session_id]['stats']['attendance_records'] += new_records
            
            processing_time = time.time() - start_time
            
            # Update capture log
            advanced_metrics = {
                'processing_method': 'advanced_similarity',
                'confidence_distribution': {},
                'total_faces_detected': len(detected_faces),
                'total_faces_recognized': len([f for f in detected_faces if f['verified']])
            }
            
            for face in detected_faces:
                confidence_level = face.get('confidence_level', 'unknown')
                advanced_metrics['confidence_distribution'][confidence_level] = \
                    advanced_metrics['confidence_distribution'].get(confidence_level, 0) + 1
            
            update_data = {
                'faces_detected': len(detected_faces),
                'faces_recognized': len([f for f in detected_faces if f['verified']]),
                'new_records': new_records,
                'processing_time_ms': int((time.time() - start_time) * 1000),
                'processing_status': 'completed',
                'attendance_records_created': new_records
            }
            
            self.supabase_mgr.update_motion_capture(session_id, item['capture_time'], update_data)
            
            logger.info(f"🚀 Motion capture complete: {new_records} new records in {processing_time:.2f}s")
            
            return {
                'success': True,
                'new_records': new_records,
                'already_checked': already_checked,
                'faces_detected': len(detected_faces),
                'processing_time': processing_time,
                'unrecognized': unrecognized,

                # Spoof detection results
                'spoof_detected': spoof_count > 0,
                'spoof_count': spoof_count,
                'spoof_timestamp': spoof_timestamp,
                'spoof_image_b64': spoof_image_b64
            }
            
        except Exception as e:
            logger.error(f"❌ Error in motion processing: {e}")
            try:
                update_data = {'processing_status': 'failed', 'error_message': str(e)}
                self.supabase_mgr.update_motion_capture(item['session_id'], item['capture_time'], update_data)
            except:
                pass
            
            return {'success': False, 'error': str(e), 'new_records': 0}


# Global instances
motion_processor = MotionDetectionProcessor()
motion_session_manager = MotionSessionManager()
motion_priority_queue = MotionPriorityQueue()
motion_processing_service = MotionProcessingService()
frame_skipper = FrameSkippingManager()
user_cooldown_manager = PerUserCooldownManager()