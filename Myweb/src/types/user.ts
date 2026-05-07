/**
 * user.types.ts
 * ---------------------------------------------------------------
 * ครอบคลุม: users, student_face_embeddings
 *
 * เหตุผลที่อยู่ด้วยกัน:
 *   - Face embedding เป็นข้อมูลที่ผูกติดกับ student (user) โดยตรง
 *   - ทั้งคู่ใช้ใน enrollment flow และ face recognition pipeline
 * ---------------------------------------------------------------
 */

import type { UserRole, EnrollmentType } from './common.ts'

export interface User {
  user_id: string        // uuid PK
  email: string
  full_name: string | null
  school_id: string | null
  role: UserRole
  password_hash: string
  created_at: string     // timestamptz → ISO string
  updated_at: string
}

export interface StudentFaceEmbedding {
  id: number             // serial PK
  student_id: string     // FK → users.school_id
  face_embedding_json: string  // JSON string ของ embedding vector
  face_quality: number   // 0.00–1.00
  enrollment_type: EnrollmentType
  images_used: number
  system_version: string
  motion_optimized: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

// --- Derived / View types ---

/** Safe user object ที่ตัด password ออกแล้ว (ใช้ส่งไป client) */
export type SafeUser = Omit<User, 'password_hash'>

/** ข้อมูล user ขั้นต่ำสำหรับ FK reference */
export type UserRef = Pick<User, 'user_id' | 'full_name' | 'email' | 'school_id'>