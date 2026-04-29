# 📋 Database Schema & RLS Policies Fix Summary

## 🔍 ปัญหาที่พบ

### 1. **RLS Policies ไม่ตรงกับ Schema จริง**
- Policy: `"Teachers can view records for their sessions"` อ้างถึง `attendance_sessions` ตาราง ❌
- ควรอ้างถึง `attendance_records` ตาราง ✅

### 2. **Face Embeddings Policy ไม่ชัดเจน**
- Policy ใช้ `student_id` (VARCHAR) ที่อ้างอิงไป `users(school_id)`
- ไม่มีการอนุญาตให้ Teachers ดูข้อมูลนักเรียน

### 3. **ไม่มี Admin Role Bypass**
- Policies ไม่มี bypass สำหรับ admin
- Admin ไม่สามารถจัดการข้อมูลได้

### 4. **ขาดส่วนประกอบสำคัญในตาราง**
- `student_face_embeddings`: ขาดคอลัมน์ metadata, embedding_index, is_normalized
- `motion_captures`: ขาดคอลัมน์ session_duration_ms
- ขาดฟังก์ชัน trigger สำหรับ validation

---

## ✅ วิธีแก้ไข

### Step 1: อัปเดต RLS Policies
ไฟล์ `04_rls_policies.sql` ได้แก้ไขให้:
- ✅ แก้ไข "Teachers can view records for their sessions" ให้อ้างถึง `attendance_records` ตาราง
- ✅ เพิ่ม Policy ให้ Teachers ดูและจัดการ face embeddings ของนักเรียน
- ✅ เพิ่ม Admin bypass policies

### Step 2: เพิ่มคอลัมน์และ Triggers
ไฟล์ใหม่ `06_fix_schema_compatibility.sql` ประกอบด้วย:

**เพิ่มคอลัมน์:**
```sql
-- student_face_embeddings
- embedding_index: เพื่อติดตามลำดับการเพิ่มข้อมูล
- total_embeddings: จำนวน embeddings ทั้งหมด
- is_normalized: ว่านัยว่า embedding ได้ normalization แล้วหรือไม่
- metadata_json: เก็บข้อมูล metadata

-- motion_captures
- attendance_records_created: จำนวน attendance records ที่สร้าง
- session_duration_ms: ระยะเวลา session
```

**สร้าง Triggers:**
- `update_attendance_sessions_timestamp`: อัปเดต updated_at อัตโนมัติ
- `validate_attendance_status`: ตรวจสอบค่า status ก่อน insert/update

**สร้าง Views:**
```sql
v_student_class_enrollment -- ดึงข้อมูลนักเรียนทั้งหมดในคลาส
v_student_face_data -- ข้อมูล face embeddings พร้อม user info
v_motion_session_summary -- สรุป motion session
```

**เพิ่ม Indexes:**
- `idx_attendance_records_created_at`: สำหรับค้นหาแบบ time-based
- `idx_attendance_records_session_student`: composite index สำหรับเร็ว
- `idx_motion_captures_session_capture`: สำหรับ motion queries

---

## 📝 Schema ที่ถูกต้อง

### ตาราง Key Relationships:

```
users (user_id, email, school_id)
├── classes (teacher_id → users.user_id)
│   ├── student_enrollments (class_id → classes.class_id)
│   │   └── student_id → users.user_id
│   └── attendance_sessions (class_id → classes.class_id)
│       ├── attendance_records (session_id → attendance_sessions.id)
│       │   └── student_email → users.email
│       └── motion_captures (session_id → attendance_sessions.id)
│
└── student_face_embeddings (student_id → users.school_id)
```

---

## 🚀 Installation Steps

### 1. Supabase SQL Editor - รันตามลำดับนี้:

**Step A: อัปเดต RLS Policies**
```sql
-- Copy & Run: 04_rls_policies.sql
```

**Step B: เพิ่ม Schema Components**
```sql
-- Copy & Run: 06_fix_schema_compatibility.sql
```

### 2. ตรวจสอบ Policies ถูกต้อง:
```sql
-- ดูทุก Policies
SELECT schemaname, tablename, policyname 
FROM pg_policies 
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

### 3. ทดสอบ Views:
```sql
SELECT * FROM v_student_class_enrollment LIMIT 5;
SELECT * FROM v_student_face_data LIMIT 5;
SELECT * FROM v_motion_session_summary;
```

---

## 💾 ไฟล์ที่แก้ไข/สร้าง

| ไฟล์ | สถานะ | หมายเหตุ |
|------|------|---------|
| `04_rls_policies.sql` | ✅ แก้ไข | Fixed RLS policies |
| `06_fix_schema_compatibility.sql` | ✅ สร้างใหม่ | Schema enhancements |
| [state_module.py](../../face_recognition_server/state_module.py#L106) | ✅ แก้ไข | Table names |
| [main_refactored.py](../../face_recognition_server/main_refactored.py#L103) | ✅ แก้ไข | Table references |

---

## 🔐 RLS Policy Reference

### Student:
- ✅ ดูข้อมูล user เองได้
- ✅ ดูคลาสที่ลงทะเบียน
- ✅ ดู attendance records เอง
- ✅ ดู face embeddings เอง

### Teacher:
- ✅ จัดการคลาสตัวเอง
- ✅ ดูคลาสของตัวเอง
- ✅ ดูนักเรียนที่ลงทะเบียน
- ✅ ดู attendance records ของคลาส
- ✅ ดู motion captures ของคลาส
- ✅ จัดการ face embeddings ของนักเรียน

### Admin:
- ✅ สามารถเข้าถึง/จัดการได้ทั้งหมด

---

## 🎯 ขั้นต่อไป

1. **รัน SQL migrations ตามลำดับ**
2. **ทดสอบ Policies กับ Supabase CLI**
```bash
supabase status
supabase db list
```
3. **ทดสอบ Python code กับฐานข้อมูลใหม่**
4. **เรียกใช้ Views ผ่าน Python API**

---

*Last Updated: 2026-04-30*
*Database Schema Version: 1.2*
*RLS Policies Version: 1.1*
