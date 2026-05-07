/**
 * attendance.types.ts
 * ---------------------------------------------------------------
 * ครอบคลุม: attendance_sessions, attendance_records, motion_captures
 *
 * เหตุผลที่อยู่ด้วยกัน:
 *   - ทั้งสามคือ "event pipeline" ของการเช็คชื่อ:
 *     Session (เปิดคลาส) → MotionCapture (จับภาพ) → AttendanceRecord (บันทึกผล)
 *   - มี foreign key ต่อกันเป็น chain: session ← capture, session ← record
 *   - แก้หนึ่งมักต้องดูอีกสองเสมอ
 * ---------------------------------------------------------------
 */

import type {
  AttendanceStatus,
  SessionStatus,
  SessionType,
  DetectionMethod,
  TriggerType,
  ProcessingStatus,
} from './common.ts'
import type { ClassRef } from './class.ts'

// ----------------------------------------------------------------
// DB Models
// ----------------------------------------------------------------

export interface AttendanceSession {
  id: string                    // uuid PK
  class_id: string | null       // FK → classes.class_id
  teacher_email: string
  start_time: string
  end_time: string | null
  on_time_limit_minutes: number
  status: SessionStatus
  session_type: SessionType
  motion_threshold: number      // 0.00–1.00  (เช่น 0.15 = 15%)
  cooldown_seconds: number
  max_snapshots_per_hour: number
  created_at: string
  updated_at: string
}

export interface AttendanceRecord {
  id: string                    // uuid PK
  session_id: string | null     // FK → attendance_sessions.id
  student_email: string         // FK → users.email
  student_id: string            // school_id (text)
  check_in_time: string
  status: AttendanceStatus
  face_match_score: number | null  // 0.000–1.000
  detection_method: DetectionMethod
  processing_phase: string | null
  face_quality: number          // 0.00–1.00
  motion_strength: number       // 0.000–1.000
  trigger_type: TriggerType
  device_id: string | null
  created_at: string
}

export interface MotionCapture {
  id: number                    // serial PK
  session_id: string            // FK → attendance_sessions.id
  capture_time: string
  capture_type: string
  trigger_type: TriggerType
  motion_strength: number       // 0.000–1.000
  processing_phase: string | null
  faces_detected: number
  faces_recognized: number
  new_records: number
  processing_time_ms: number
  processing_status: ProcessingStatus
  block_reason: string | null
  queue_priority: number
  device_id: string | null
  force_capture: boolean
  error_message: string | null
  created_at: string
  optimization_version: string
}

// ----------------------------------------------------------------
// Derived / Joined types
// ----------------------------------------------------------------

/** Session พร้อมข้อมูล class (ใช้แสดงใน session list) */
export interface SessionWithClass extends AttendanceSession {
  class: ClassRef
}

/** Record พร้อมชื่อนักเรียน (ใช้แสดงใน attendance report) */
export interface AttendanceRecordWithStudent extends AttendanceRecord {
  student_name: string | null
}