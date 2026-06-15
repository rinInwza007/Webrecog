// ─────────────────────────────────────────────────────────────
// Grading Settings
// ─────────────────────────────────────────────────────────────

/**
 * ค่าคะแนนแต่ละสถานะการเข้าเรียน + คะแนนเต็ม
 * → ตรงกับ class_grading_settings table
 */
export interface ClassGradingSettings {
  id: string
  class_id: string
  present_score: number       // default 1
  late_score: number          // default 0.5
  leave_score: number         // default 0.5
  absent_score: number        // default 0
  max_attendance_score: number // default 20
  updated_by: string | null
  created_at: string
  updated_at: string
}

/** ค่า default ใช้ตอน reset หรือสร้าง class ใหม่ */
export const DEFAULT_GRADING_SETTINGS = {
  present_score:        1,
  late_score:           0.5,
  leave_score:          0.5,
  absent_score:         0,
  max_attendance_score: 20,
} as const

