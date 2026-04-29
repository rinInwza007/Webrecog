# 🚀 Complete Database Schema & Code Integration Fix

## ✅ ทั้งหมดที่แก้ไขแล้ว

### 1️⃣ Database Schema Fixes
- ✅ **04_rls_policies.sql** - แก้ไข RLS policies ให้ตรงกับ schema จริง
  - แก้ policy "Teachers can view records for their sessions" - เปลี่ยนจาก attendance_sessions → attendance_records
  - เพิ่ม policy ให้ teachers จัดการ face embeddings ของนักเรียน
  - เพิ่ม admin bypass policies

- ✅ **06_fix_schema_compatibility.sql** - เพิ่มส่วนประกอบสำคัญ
  - เพิ่มคอลัมน์: embedding_index, total_embeddings, is_normalized, metadata_json
  - สร้าง Triggers: update_attendance_sessions_timestamp, validate_attendance_status
  - สร้าง 3 Views ที่สำคัญ:
    - `v_student_class_enrollment` - ดึงข้อมูลนักเรียนในคลาส
    - `v_student_face_data` - ข้อมูล face embeddings พร้อม user info
    - `v_motion_session_summary` - สรุป motion session
  - เพิ่ม Indexes สำหรับการค้นหาที่เร็วขึ้น

### 2️⃣ Python Code Fixes
- ✅ **database_view_helper.py** (ไฟล์ใหม่)
  - `DatabaseViewHelper` class ที่ query optimized views
  - Methods:
    - `get_student_enrollments()` - ดึงคลาสของนักเรียน
    - `get_class_students_enrolled()` - ดึงนักเรียนในคลาส
    - `get_student_face_data()` - ดึง face embeddings
    - `get_class_face_embeddings()` - ดึง embeddings ทั้งคลาส
    - `get_motion_session_summary()` - ดึง motion session summary
    - `check_missing_face_embeddings_for_class()` - ตรวจสอบนักเรียนที่ขาด embeddings

- ✅ **state_module.py** 
  - อัปเดต `get_enrolled_students_for_class()` 
  - เพิ่ม fallback query ถ้า view ไม่สำเร็จ
  - โค้ดสะอาด + error handling ที่ดี

- ✅ **main_refactored.py**
  - เพิ่ม import `DatabaseViewHelper`
  - สร้าง instance: `db_view_helper = DatabaseViewHelper(...)`
  - อัปเดต `get_enrolled_students_for_class()` ให้ใช้ helper
  - ลบการอ้างอิง 'class_students' table ที่ไม่มีอยู่

---

## 📋 Schema Diagram (แก้ไขแล้ว)

```
┌─────────────────────────────────────────────────────────────┐
│                  USERS (user_id)                            │
│  email, full_name, school_id, role, password_hash          │
└──────────────┬──────────────────────────────────────────────┘
               │
        ┌──────┴────────┐
        │               │
    (teacher_id)   (school_id)
        │               │
        │               ├──────────────────────────────┐
        │               │                              │
        ▼               ▼                              ▼
    ┌────────┐   ┌──────────────┐   ┌─────────────────────────┐
    │CLASSES │   │STUDENT_FACE_ │   │V_STUDENT_CLASS_         │
    │        │   │EMBEDDINGS    │   │ENROLLMENT (VIEW)        │
    │teacher_├──→│(student_id)  │   │                         │
    │_id     │   └──────────────┘   │ Joins student_          │
    │        │                      │ enrollments + users +    │
    │class_id├──┐                   │ classes                 │
    │        │  │                   └─────────────────────────┘
    └────────┘  │
        │       │(class_id)
        │       │
        │   ┌───────────────┐
        │   │STUDENT_       │
        │   │ENROLLMENTS    │
        │   │               │
        │   │(student_id)───→ USERS(user_id)
        │   │               │
        │   │(class_id)─────→ CLASSES(class_id)
        │   └───────────────┘
        │
    ┌───┴────────────────────────┐
    │                            │
    ▼                            ▼
┌────────────────┐   ┌──────────────────┐
│ATTENDANCE_     │   │MOTION_           │
│SESSIONS        │   │CAPTURES          │
│                │   │                  │
│(id)├──┬────────┼──→│(session_id)      │
│    │  │        │   └──────────────────┘
└────┼──┘        │
     │           │(session_id)
     ▼           │
┌─────────────────┼────┐
│ATTENDANCE_      │    │
│RECORDS          │    │
│                 │    │
│(session_id)─────┘    │
│(student_email)──────→ USERS(email)
└─────────────────────┘
```

---

## 🔧 Installation Checklist

### Phase 1: Database (Supabase SQL Editor)
- [ ] Run `04_rls_policies.sql` (แก้ไข RLS policies)
- [ ] Run `06_fix_schema_compatibility.sql` (เพิ่ม views/triggers/indexes)
- [ ] ตรวจสอบ views ทำงาน:
```sql
SELECT COUNT(*) FROM v_student_class_enrollment;
SELECT COUNT(*) FROM v_student_face_data;
SELECT COUNT(*) FROM v_motion_session_summary;
```

### Phase 2: Python Code
- [ ] ไฟล์ที่อัปเดตแล้ว:
  - ✅ `database_view_helper.py` (ใหม่)
  - ✅ `state_module.py` (แก้ไข)
  - ✅ `main_refactored.py` (แก้ไข)

### Phase 3: Testing
- [ ] ทดสอบ get_enrolled_students_for_class():
```python
students = await get_enrolled_students_for_class("class_id")
print(f"Found {len(students)} students: {students}")
```

- [ ] ทดสอบ DatabaseViewHelper:
```python
from database_view_helper import DatabaseViewHelper
from state_module import supabase_manager

helper = DatabaseViewHelper(supabase_manager.get_client())
students = helper.get_class_students_enrolled("class_id")
print(students)
```

- [ ] ทดสอบ face recognition:
```bash
curl -X POST http://localhost:8080/api/debug/test-advanced-recognition \
  -F "image=@sample.jpg" \
  -F "class_id=class_id" \
  -F "use_advanced_similarity=true"
```

---

## 🎯 Key Improvements

| ปัญหา | ก่อน | หลัง |
|------|------|------|
| ตารางไม่สอดคล้อง | Reference 'class_students' (ไม่มี) | ใช้ 'student_enrollments' (ถูก) |
| RLS Policies | Policies ไม่ตรงกับ schema | แก้ไขให้ตรงกับ schema จริง |
| Query หลายขั้น | N+1 queries ช้า | ใช้ views ที่ optimize แล้ว |
| Face matching ช้า | ดึงข้อมูลทีละตัวหนึ่ง | Batch query ผ่าน views |
| Admin access | Admin ไม่มี bypass | เพิ่ม admin bypass policies |
| Face data integrity | ไม่ check หาย | Views + check functions |

---

## 📚 API Usage Examples

### ดึงนักเรียนในคลาส (สำหรับเช็คใบหน้า)
```python
helper = DatabaseViewHelper(supabase_manager.get_client())

# ได้ข้อมูลนักเรียนทั้งหมดในคลาส
students = helper.get_class_students_enrolled("class_123")
# Returns: [
#   {'student_id': uuid, 'school_id': 'STU001', 'student_email': 'stu@school.com', ...},
#   ...
# ]
```

### ดึง Face Embeddings สำหรับ Recognition
```python
# ได้ embeddings พร้อม user info
embeddings = helper.get_class_face_embeddings("class_123")
# Returns: [
#   {'school_id': 'STU001', 'face_embedding_json': '[...]', 'is_active': true, ...},
#   ...
# ]
```

### ดึง Motion Session Summary
```python
summary = helper.get_motion_session_summary("session_uuid")
# Returns: {
#   'session_id': uuid,
#   'total_captures': 45,
#   'captures_with_faces': 38,
#   'captures_with_recognition': 32,
#   'total_records_created': 28,
#   'avg_motion_strength': 0.52,
#   ...
# }
```

### ตรวจสอบนักเรียนที่ขาด Face Embeddings
```python
missing = helper.check_missing_face_embeddings_for_class("class_123")
# Returns: [
#   {'student_id': uuid, 'school_id': 'STU002', 'student_name': 'John', ...},
#   ...
# ]
```

---

## 🐛 Troubleshooting

### ❌ Error: "view does not exist"
→ รัน `06_fix_schema_compatibility.sql` ใหม่

### ❌ Error: "RLS policy violation"
→ รัน `04_rls_policies.sql` ใหม่ และตรวจสอบ auth.uid()

### ❌ Error: "No enrolled students found"
→ เช็ค:
1. มี record ใน `student_enrollments` หรือไม่?
2. `status = 'active'` หรือไม่?
```sql
SELECT * FROM student_enrollments WHERE class_id = 'class_id';
```

### ❌ Face Recognition ไม่เจอตัวนักเรียน
→ เช็ค:
1. Face embeddings ม ีอยู่หรือไม่?
```sql
SELECT COUNT(*) FROM v_student_face_data WHERE school_id = 'STU001';
```

2. student_id ในตาราง student_face_embeddings ตรงกับ users.school_id หรือไม่?

---

## 📁 Files Modified/Created

| ไฟล์ | สถานะ | หมายเหตุ |
|------|------|---------|
| `04_rls_policies.sql` | 📝 แก้ไข | Fixed RLS |
| `06_fix_schema_compatibility.sql` | ✨ ใหม่ | Views + Triggers + Indexes |
| `database_view_helper.py` | ✨ ใหม่ | Helper class |
| `state_module.py` | 📝 แก้ไข | Use views + fallback |
| `main_refactored.py` | 📝 แก้ไข | Use DatabaseViewHelper |
| `DATABASE_SCHEMA_FIXES.md` | ✨ ใหม่ | Schema docs |

---

*Last Updated: 2026-04-30*
*Database Version: 1.2*
*Python Code Version: 6.0.1-refactored*
