# ==================== Database View Helpers ====================
# Responsible for: Querying optimized views and performing joins
# Uses: PostgreSQL views and indexes for better performance

import logging
from typing import Optional, Dict, Any, List
from datetime import datetime
from supabase import Client

logger = logging.getLogger(__name__)

class DatabaseViewHelper:
    """Helper class for querying database views"""
    
    def __init__(self, supabase_client: Client):
        self.client = supabase_client
    
    # ==================== Student Enrollment Views ====================
    
    def get_student_enrollments(self, student_id: str) -> List[Dict[str, Any]]:
        """Get all class enrollments for a student using optimized view"""
        try:
            result = self.client.table('v_student_class_enrollment').select('*')\
                .eq('student_id', student_id)\
                .execute()
            
            if result.data:
                logger.info(f"✅ Found {len(result.data)} enrollments for student {student_id}")
                return result.data
            return []
            
        except Exception as e:
            logger.error(f"Error getting student enrollments: {e}")
            return []
    
    def get_class_students_enrolled(self, class_id: str) -> List[Dict[str, Any]]:
        """Get all enrolled students in a class using optimized view"""
        try:
            result = self.client.table('v_student_class_enrollment').select('*')\
                .eq('class_id', class_id)\
                .eq('status', 'active')\
                .execute()
            
            if result.data:
                logger.info(f"✅ Found {len(result.data)} active students in class {class_id}")
                return result.data
            return []
            
        except Exception as e:
            logger.error(f"Error getting class students: {e}")
            return []
    
    def get_teacher_classes(self, teacher_id: str) -> List[Dict[str, Any]]:
        """Get all classes taught by a teacher"""
        try:
            result = self.client.table('v_student_class_enrollment').select(
                'class_id, subject_name, class_code, teacher_id'
            ).eq('teacher_id', teacher_id).distinct().execute()
            
            if result.data:
                logger.info(f"✅ Found {len(result.data)} classes for teacher {teacher_id}")
                return result.data
            return []
            
        except Exception as e:
            logger.error(f"Error getting teacher classes: {e}")
            return []
    
    # ==================== Face Data Views ====================
    
    def get_student_face_data(self, school_id: str) -> Optional[Dict[str, Any]]:
        """Get face embedding data for a student using optimized view"""
        try:
            result = self.client.table('v_student_face_data').select('*')\
                .eq('school_id', school_id)\
                .single().execute()
            
            if result.data:
                logger.info(f"✅ Retrieved face data for {school_id}")
                return result.data
            return None
            
        except Exception as e:
            logger.error(f"Error getting face data: {e}")
            return None
    
    def get_class_face_embeddings(self, class_id: str) -> List[Dict[str, Any]]:
        """Get all face embeddings for students in a class"""
        try:
            # First get all enrolled students
            students = self.get_class_students_enrolled(class_id)
            
            if not students:
                return []
            
            # Then get face data for each student
            face_data = []
            for student in students:
                face = self.get_student_face_data(student['school_id'])
                if face:
                    face_data.append(face)
            
            logger.info(f"✅ Retrieved {len(face_data)} face embeddings for class {class_id}")
            return face_data
            
        except Exception as e:
            logger.error(f"Error getting class face embeddings: {e}")
            return []
    
    # ==================== Motion Session Views ====================
    
    def get_motion_session_summary(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Get motion session summary using optimized view"""
        try:
            result = self.client.table('v_motion_session_summary').select('*')\
                .eq('session_id', session_id)\
                .single().execute()
            
            if result.data:
                logger.info(f"✅ Retrieved motion summary for session {session_id}")
                return result.data
            return None
            
        except Exception as e:
            logger.error(f"Error getting motion session summary: {e}")
            return None
    
    def get_class_motion_sessions_summary(self, class_id: str) -> List[Dict[str, Any]]:
        """Get motion session summaries for a class"""
        try:
            result = self.client.table('v_motion_session_summary').select('*')\
                .eq('class_id', class_id)\
                .order('last_capture', desc=True)\
                .execute()
            
            if result.data:
                logger.info(f"✅ Retrieved {len(result.data)} motion summaries for class {class_id}")
                return result.data
            return []
            
        except Exception as e:
            logger.error(f"Error getting class motion summaries: {e}")
            return []
    
    # ==================== Attendance Summary ====================
    
    def get_session_attendance_summary(self, session_id: str) -> Dict[str, Any]:
        """Get attendance summary for a session"""
        try:
            # Count attendance by status
            result = self.client.table('attendance_records').select('status, count(*)')\
                .eq('session_id', session_id)\
                .execute()
            
            summary = {
                'present': 0,
                'late': 0,
                'absent': 0
            }
            
            if result.data:
                # Note: This might need adjustment based on actual Supabase response format
                for record in result.data:
                    if record.get('status') in summary:
                        summary[record['status']] = record.get('count', 0)
            
            total = sum(summary.values())
            logger.info(f"✅ Session attendance: {summary} (total: {total})")
            return summary
            
        except Exception as e:
            logger.error(f"Error getting attendance summary: {e}")
            return {'present': 0, 'late': 0, 'absent': 0}
    
    def get_student_attendance_history(self, student_email: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Get recent attendance history for a student"""
        try:
            result = self.client.table('attendance_records').select('*')\
                .eq('student_email', student_email)\
                .order('check_in_time', desc=True)\
                .limit(limit)\
                .execute()
            
            if result.data:
                logger.info(f"✅ Retrieved {len(result.data)} attendance records for {student_email}")
                return result.data
            return []
            
        except Exception as e:
            logger.error(f"Error getting attendance history: {e}")
            return []
    
    # ==================== Performance Queries ====================
    
    def get_face_embeddings_for_class_optimized(self, class_id: str) -> List[tuple]:
        """Get face embeddings for fast recognition matching
        Returns tuples of (school_id, face_embedding_vector) for faster processing
        """
        try:
            # Get student enrollments
            result = self.client.table('v_student_class_enrollment').select(
                'school_id'
            ).eq('class_id', class_id).eq('status', 'active').execute()
            
            if not result.data:
                return []
            
            school_ids = [r['school_id'] for r in result.data]
            embeddings = []
            
            # Batch fetch embeddings (more efficient than per-student queries)
            for school_id in school_ids:
                emb_result = self.client.table('v_student_face_data').select(
                    'school_id, face_embedding_json'
                ).eq('school_id', school_id).single().execute()
                
                if emb_result.data:
                    embeddings.append((school_id, emb_result.data.get('face_embedding_json')))
            
            logger.info(f"✅ Retrieved {len(embeddings)} embeddings for class recognition")
            return embeddings
            
        except Exception as e:
            logger.error(f"Error getting optimized embeddings: {e}")
            return []
    
    # ==================== Data Integrity Checks ====================
    
    def check_orphaned_attendance_records(self) -> List[Dict[str, Any]]:
        """Check for attendance records with missing sessions (data integrity)"""
        try:
            # Direct SQL query for orphan check
            result = self.client.rpc(
                'get_orphaned_attendance_records'
            ).execute()
            
            if result.data:
                logger.warning(f"⚠️  Found {len(result.data)} orphaned attendance records")
                return result.data
            return []
            
        except Exception as e:
            logger.info(f"Orphan check not available via RPC: {e}")
            return []
    
    def check_missing_face_embeddings_for_class(self, class_id: str) -> List[Dict[str, Any]]:
        """Check for students without face embeddings in a class"""
        try:
            # Get enrolled students
            students = self.get_class_students_enrolled(class_id)
            
            missing = []
            for student in students:
                face = self.get_student_face_data(student['school_id'])
                if not face:
                    missing.append({
                        'student_id': student['student_id'],
                        'school_id': student['school_id'],
                        'student_name': student['student_name'],
                        'student_email': student['student_email']
                    })
            
            if missing:
                logger.warning(f"⚠️  {len(missing)} students in class {class_id} missing face embeddings")
                return missing
            
            return []
            
        except Exception as e:
            logger.error(f"Error checking missing embeddings: {e}")
            return []


# Example usage
if __name__ == "__main__":
    from state_module import supabase_manager
    
    db_helper = DatabaseViewHelper(supabase_manager.get_client())
    
    # Example queries
    # students = db_helper.get_class_students_enrolled("class_id")
    # face_data = db_helper.get_class_face_embeddings("class_id")
    # motion_summary = db_helper.get_motion_session_summary("session_id")
