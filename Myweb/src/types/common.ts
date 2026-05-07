/**
 * common.types.ts
 * ---------------------------------------------------------------
 * Shared enums และ primitive types ที่ถูกใช้ข้ามหลายไฟล์
 * ไฟล์นี้ไม่ควร import จากไฟล์อื่นใน /types เลย (zero dependency)
 * ---------------------------------------------------------------
 */

// --- User & Auth ---
export type UserRole = 'student' | 'teacher' | 'admin'

// --- Attendance ---
export type AttendanceStatus = 'present' | 'late' | 'absent'
export type SessionStatus    = 'active' | 'ended' | 'cancelled'
export type SessionType      = 'standard' | 'motion_detection'
export type DetectionMethod  = 'manual' | 'face_recognition' | 'motion_detection'
export type TriggerType      = 'manual' | 'motion' | 'scheduled'

// --- Enrollment & Face ---
export type EnrollmentStatus = 'active' | 'inactive' | 'dropped'
export type EnrollmentType   = 'standard' | 'manual' | 'bulk'

// --- System ---
export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed'

// --- Generic API wrapper ---
export interface ApiResponse<T = undefined> {
  success: boolean
  detail?: string
  data?: T
}