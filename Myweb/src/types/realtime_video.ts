/**
 * realtime-video.types.ts
 * ---------------------------------------------------------------
 * Types เฉพาะของ RealTimeVideoAttendance component
 *
 * เหตุผลที่แยกออกมา:
 *   - เป็น "View Model" — transform ข้อมูล DB มาเป็น shape ที่ UI ต้องการ
 *   - ใช้ camelCase ตาม React convention (ต่างจาก snake_case ของ DB)
 *   - ถ้าเปลี่ยน component นี้ ไฟล์นี้ก็เปลี่ยนตาม โดยไม่กระทบ DB types
 *   - Component อื่นไม่ควร import ไฟล์นี้
 * ---------------------------------------------------------------
 */

import type { AttendanceStatus } from './common.ts'

// ----------------------------------------------------------------
// Component State
// ----------------------------------------------------------------

/** Counter stats ที่แสดงใน Processing Statistics panel */
export interface StreamStats {
  frames_processed: number
  faces_detected: number
  faces_recognized: number
  attendance_recorded: number
}

// ----------------------------------------------------------------
// View Model — map มาจาก AttendanceRecord สำหรับแสดงใน Live Attendance list
// ----------------------------------------------------------------

/**
 * AttendanceListItem
 * ---------------------------------------------------------------
 * DB field          → UI field
 * id                → id
 * student_name      → studentName   (join จาก users)
 * student_id        → studentId
 * status            → status
 * face_match_score  → confidence
 * check_in_time     → timestamp
 * is_manual (logic) → isManual
 */
export interface AttendanceListItem {
  id: string | number
  studentName: string
  studentId: string
  status: AttendanceStatus
  confidence: number      // 0.0–1.0  (face_match_score หรือ 1.0 ถ้า manual)
  timestamp: string       // ISO string
  isManual: boolean
}

// ----------------------------------------------------------------
// Component Props
// ----------------------------------------------------------------

export interface RealTimeVideoAttendanceProps {
  classId: string
  teacherEmail: string
  /** callback เมื่อ teacher กด End Class — ส่ง attendance list ล่าสุดกลับออกไป */
  onSessionEnd?: (attendanceList: AttendanceListItem[]) => void
}