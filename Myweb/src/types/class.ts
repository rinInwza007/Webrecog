/**
 * class.types.ts
 * ---------------------------------------------------------------
 * ครอบคลุม: classes, student_enrollments
 *
 * เหตุผลที่อยู่ด้วยกัน:
 *   - Enrollment คือ relationship ระหว่าง student กับ class
 *   - ทั้งสองถูกใช้คู่กันเสมอใน "Class Management" feature
 *   - ไม่มีเหตุผลที่จะเปิด class โดยไม่ดู enrollment และกลับกัน
 * ---------------------------------------------------------------
 */

import type { EnrollmentStatus, SessionType } from './common.ts'
import type { UserRef } from './user.ts'

// ─────────────────────────────────────────────────────────────
// Attendance Settings
// แยกเป็น 2 ส่วน:
//   1. ClassAttendanceSettings  → teacher ตั้งได้ (เก็บใน DB)
//   2. SessionTechnicalDefaults → fixed ใน codebase ไม่ expose UI
// ─────────────────────────────────────────────────────────────

/**
 * ค่าที่ teacher ตั้งได้ระดับ class
 * → ถูก snapshot เข้า attendance_sessions ทุกครั้งที่สร้าง session
 */
export interface ClassAttendanceSettings {
  /** รูปแบบ session เริ่มต้น */
  default_session_type: SessionType

  /** กี่ชั่วโมงของคลาสเรียน */
  default_duration_hours: number

  /** กี่นาทีหลัง start_time ถือว่าสาย */
  default_on_time_limit_minutes: number

  /** ครั้งล่าสุดที่แก้ไข attendance settings */
  attendance_settings_updated_at: string
}

/**
 * ค่า technical ที่ fixed ในระบบ — ไม่ expose ใน UI
 * ใช้เป็น fallback ใน trigger / server-side เท่านั้น
 */
export const SESSION_TECHNICAL_DEFAULTS = {
  motion_threshold:        0.10,
  cooldown_seconds:        30,
  max_snapshots_per_hour:  120,
} as const

/** ค่า default ใช้ตอน reset หรือสร้าง class ใหม่ */
export const DEFAULT_ATTENDANCE_SETTINGS: ClassAttendanceSettings = {
  default_session_type:           'standard',
  default_duration_hours:         2,
  default_on_time_limit_minutes:  30,
  attendance_settings_updated_at: new Date().toISOString(),
}

// ─────────────────────────────────────────────────────────────
// Class
// ─────────────────────────────────────────────────────────────

export interface Class extends ClassAttendanceSettings {
  class_id: string
  subject_name: string
  description: string | null
  schedule: string | null
  total_sessions: number | null
  max_checkins_per_week: number | null
  teacher_id: string | null
  teacher_email: string
  class_code: string
  created_at: string
  updated_at: string
}

// ─────────────────────────────────────────────────────────────
// Enrollment
// ─────────────────────────────────────────────────────────────

export interface StudentEnrollment {
  enrollment_id: string
  student_id: string | null
  class_id: string | null
  enrolled_at: string
  status: EnrollmentStatus
}

// ─────────────────────────────────────────────────────────────
// Derived / Joined types
// ─────────────────────────────────────────────────────────────

/** Class พร้อมข้อมูล teacher (ใช้แสดงใน class list) */
export interface ClassWithTeacher extends Class {
  teacher: UserRef
}

/** Class ย่อสำหรับ FK reference */
export type ClassRef = Pick<Class, 'class_id' | 'subject_name' | 'class_code'>

/** Enrollment พร้อมรายละเอียดทั้ง student และ class (ใช้ใน admin panel) */
export interface EnrollmentWithDetails extends StudentEnrollment {
  student: UserRef
  class: ClassRef
}