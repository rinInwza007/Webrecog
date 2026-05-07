/**
 * api.types.ts
 * ---------------------------------------------------------------
 * Request / Response shapes สำหรับทุก API endpoint
 *
 * เหตุผลที่แยกออกมาไฟล์เดียว:
 *   - API types เป็น "contract" ระหว่าง frontend กับ backend
 *   - เปลี่ยนแปลงบ่อยและเป็นอิสระจาก DB model
 *   - ง่ายต่อการ generate จาก OpenAPI spec ในอนาคต
 *   - นักพัฒนา backend/frontend ดูแยกจาก DB model ได้ชัดเจน
 * ---------------------------------------------------------------
 */

import type { AttendanceStatus } from './common.ts'
import type { AttendanceRecord } from './attendance.ts'

// ----------------------------------------------------------------
// POST /api/realtime/start-stream
// ----------------------------------------------------------------
export interface StartStreamRequest {
  class_id: string
  teacher_email: string
  on_time_limit_minutes: number
  duration_hours: number
}

export interface StartStreamResponse {
  success: boolean
  session_id: string
  detail?: string
}

// ----------------------------------------------------------------
// POST /api/motion/snapshot
// ----------------------------------------------------------------
export interface SnapshotRequest {
  session_id: string
  motion_strength: string   // toFixed(3) — ส่งเป็น string ใน FormData
  elapsed_minutes: number
  image_data: Blob          // multipart/form-data
}

export interface SnapshotResponse {
  success: boolean
  faces_detected: number
  new_records: number
  detail?: string
}

// ----------------------------------------------------------------
// GET /api/motion/session/:sessionId/live-stats
// ----------------------------------------------------------------
export interface LiveStatsResponse {
  success: boolean
  attendance_records: number
  faces_detected: number
  snapshots_processed: number
}

// ----------------------------------------------------------------
// GET /api/session/:sessionId/attendance
// ----------------------------------------------------------------
export interface AttendanceListResponse {
  success: boolean
  data: AttendanceRecord[]
}

// ----------------------------------------------------------------
// POST /api/realtime/:sessionId/manual-checkin
// ----------------------------------------------------------------
export interface ManualCheckinRequest {
  student_email: string
  status: AttendanceStatus
}

export interface ManualCheckinResponse {
  success: boolean
  student_name: string
  status: AttendanceStatus
  timestamp: string
  detail?: string
}

// ----------------------------------------------------------------
// PUT /api/realtime/:sessionId/stop
// ----------------------------------------------------------------
export interface StopSessionResponse {
  success: boolean
  detail?: string
}