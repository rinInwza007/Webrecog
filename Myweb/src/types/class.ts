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

import type { EnrollmentStatus } from './common.ts'
import type { UserRef } from './user.ts'

export interface Class {
  class_id: string
  subject_name: string
  description: string | null
  schedule: string | null           // วันเวลาเรียน เช่น "จันทร์ 09:00-12:00"
  total_sessions: number | null     // จำนวนคาบทั้งเทอม เช่น 12
  max_checkins_per_week: number | null  // เช็คชื่อได้ต่อ week เช่น 1
  teacher_id: string | null
  teacher_email: string
  class_code: string
  created_at: string
  updated_at: string
}

export interface StudentEnrollment {
  enrollment_id: string      // uuid PK
  student_id: string | null  // FK → users.user_id
  class_id: string | null    // FK → classes.class_id
  enrolled_at: string
  status: EnrollmentStatus
}

// --- Derived / Joined types ---

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