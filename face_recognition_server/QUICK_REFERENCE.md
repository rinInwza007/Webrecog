# Refactored Server - Quick Reference Guide

## 📋 Quick Summary

Your Face Recognition Server has been refactored from **1 large file (4800+ lines)** into **3 focused modules** using a layered architecture.

```
┌─────────────────────────────────────────────────────────┐
│  API Endpoints (main_refactored.py)                     │
│  - Request/Response handling                            │
└────────────────────┬────────────────────────────────────┘
                     │
         ┌───────────┴───────────┬─────────────┐
         ▼                       ▼             ▼
    ┌────────────┐      ┌──────────────┐  ┌──────────┐
    │  AI Layer  │      │  Logic Layer │  │  State   │
    │ (ai.py)    │      │ (service.py) │  │ (state.) │
    │            │      │              │  │          │
    │ • Face     │      │ • Motion     │  │ • DB     │
    │   detect   │      │   processing │  │ • Cache  │
    │ • Embed    │      │ • Session    │  │ • State  │
    │   extract  │      │   management │  │          │
    │ • Compare  │      │ • Attendance │  │          │
    │   faces    │      │   recording  │  │          │
    └────────────┘      └──────────────┘  └──────────┘
```

---

## 📂 Files to Use

| File | Purpose | What It Does |
|------|---------|--------------|
| `ai_module.py` | Face recognition AI | Detects faces, extracts embeddings, compares similarity |
| `service_module.py` | Business logic | Motion detection, session management, attendance |
| `state_module.py` | Data access | Database queries, caching |
| `main_refactored.py` | API endpoints | HTTP endpoints (rename to `main.py` to use) |

---

## 🎯 What Goes Where?

### AI Layer (`ai_module.py`) - "Process Faces"
✅ **Should be in AI layer:**
- Face detection
- Embedding extraction
- Quality scoring
- Similarity calculations
- Encoding normalization

❌ **Should NOT be in AI layer:**
- Database queries
- Session management
- Business decisions

### Logic Layer (`service_module.py`) - "Make Decisions"
✅ **Should be in Logic layer:**
- Motion thresholds
- Session tracking
- Processing priority
- Attendance recording logic
- Orchestration

❌ **Should NOT be in Logic layer:**
- Direct database queries (use State layer)
- Face processing (use AI layer)

### State Layer (`state_module.py`) - "Store & Cache"
✅ **Should be in State layer:**
- Supabase operations
- In-memory caching
- Cache invalidation
- Database CRUD

❌ **Should NOT be in State layer:**
- Business logic
- Face processing

---

## 💻 Code Examples

### Adding a New Feature

#### Example: Add face liveness detection (AI feature)

```python
# In ai_module.py

class FaceEmbeddingProcessor:
    @staticmethod
    def check_face_liveness(image_array: np.ndarray, face_location: Tuple) -> Dict[str, float]:
        """Check if face is live (not a photo/video)"""
        # Your liveness detection logic
        return {
            'is_live_probability': 0.95,
            'liveness_score': 0.95
        }
```

#### Example: Add new motion processor config (Logic feature)

```python
# In service_module.py

class MotionDetectionProcessor:
    def __init__(self):
        self.adaptive_thresholds = {
            # ... existing ...
            'aggressive_mode': {
                'threshold': 0.02,
                'priority': 0,
                'quality_check': False
            }
        }
```

#### Example: Add email notifications (State feature)

```python
# In state_module.py

class SupabaseStateManager:
    def send_attendance_notification(self, student_email: str, status: str) -> bool:
        """Send email to student about attendance"""
        # Your email sending logic
        pass
```

#### Example: Add new endpoint (API layer)

```python
# In main_refactored.py

@app.post("/api/debug/check-liveness")
async def check_liveness(
    image: UploadFile = File(...),
    student_id: str = Form(...)
):
    # Use AI layer
    liveness_result = FaceEmbeddingProcessor.check_face_liveness(image_array, face_location)
    
    # Use State layer
    cache_manager.set_face_cache(f"liveness_{student_id}", liveness_result)
    
    return liveness_result
```

---

## 🔗 Import Examples

### Using AI Layer

```python
from ai_module import (
    FaceEmbeddingProcessor,
    SimilarityCalculator,
    AdvancedFaceEmbeddingManager,
    process_faces_with_advanced_matching
)

# Detect faces
faces = FaceEmbeddingProcessor.detect_faces_in_image(image_array)

# Extract embeddings
encodings = FaceEmbeddingProcessor.extract_face_encodings(image_array, faces)

# Compare faces
similarity = SimilarityCalculator.calculate_advanced_similarity(encoding1, encoding2)
```

### Using Logic Layer

```python
from service_module import (
    motion_processor,
    motion_session_manager,
    motion_processing_service,
    AttendanceRecordingService
)

# Get adaptive config
phase = motion_processor.get_phase(elapsed_minutes=20)
config = motion_processor.get_config(phase)

# Manage sessions
motion_session_manager.create_session(session_id, config)
stats = motion_session_manager.get_session_stats(session_id)

# Record attendance
attendance_service = AttendanceRecordingService()
await attendance_service.record_attendance_from_face(...)
```

### Using State Layer

```python
from state_module import supabase_manager, cache_manager

# Database operations
embeddings = supabase_manager.get_active_embeddings(student_id)
supabase_manager.save_attendance_record(record_data)

# Caching
cache_manager.set_embedding_cache(student_id, embedding)
cached = cache_manager.get_embedding_cache(student_id)
cache_manager.invalidate_student_cache(student_id)
```

---

## 🚀 Migration Checklist

- [ ] Copy `ai_module.py` to your project
- [ ] Copy `service_module.py` to your project
- [ ] Copy `state_module.py` to your project
- [ ] Rename `main_refactored.py` to `main.py`
- [ ] Test all endpoints work
- [ ] Update any custom imports in your code
- [ ] Test face enrollment: POST `/api/face/enroll-advanced`
- [ ] Test motion detection: POST `/api/session/start-motion-detection`
- [ ] Test snapshot: POST `/api/motion/snapshot`
- [ ] Check database queries are working
- [ ] Check cache is working (enrollment should be faster 2nd time)

---

## 🔍 Testing Each Layer Independently

### Test AI Layer (No Dependencies)

```python
import numpy as np
from ai_module import FaceEmbeddingProcessor, SimilarityCalculator

# Test face quality calculation
from PIL import Image
img = Image.open("test_face.jpg")
img_array = np.array(img)

faces = FaceEmbeddingProcessor.detect_faces_in_image(img_array)
quality = FaceEmbeddingProcessor.calculate_face_quality(img_array, faces[0])
print(f"Quality: {quality['overall_score']:.3f}")

# Test similarity (doesn't need database)
emb1 = np.random.random(128)
emb2 = np.random.random(128)
similarity = SimilarityCalculator.calculate_advanced_similarity(emb1, emb2)
print(f"Similarity: {similarity['combined_score']:.3f}")
```

### Test Logic Layer (With Mocked State)

```python
from service_module import motion_processor, motion_session_manager

# Test adaptive thresholds
phase = motion_processor.get_phase(elapsed_minutes=5)  # '0-10'
config = motion_processor.get_config(phase)
print(f"Face threshold: {config['face_threshold']}")  # 0.75

# Test session management
motion_session_manager.create_session("test_session", config)
stats = motion_session_manager.get_session_stats("test_session")
print(f"Motion events: {stats['motion_events']}")  # 0
```

### Test State Layer

```python
from state_module import supabase_manager, cache_manager

# Test cache
cache_manager.set_face_cache("key1", "value1")
cached = cache_manager.get_face_cache("key1")
print(f"Cached: {cached}")  # "value1"

# Test database
students = supabase_manager.get_enrolled_students_for_class("class_001")
print(f"Students: {students}")
```

---

## ⚙️ Configuration

All configuration is in environment variables (`.env`):

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# Server
HOST=0.0.0.0
PORT=8080
DEBUG=false

# Face Recognition
FACE_VERIFICATION_THRESHOLD=0.4

# Motion Detection
MOTION_DETECTION_ENABLED=true
MOTION_COOLDOWN_SECONDS=30
MAX_SNAPSHOTS_PER_HOUR=120
DEFAULT_MOTION_THRESHOLD=0.1
```

---

## 📊 Performance Comparison

### Before Refactoring
- Single 4800+ line file
- All logic mixed together
- Hard to find code
- Difficult to test
- No code reuse

### After Refactoring
- Main endpoints: ~500 lines
- AI module: ~800 lines
- Logic module: ~600 lines
- State module: ~300 lines
- **Benefits:** Easy to test, reuse, maintain, extend

---

## 🐛 Debugging Tips

1. **Face detection not working?**
   - Test `ai_module.py` independently
   - Check image format (should be RGB)
   - Verify face is visible and clear

2. **Database not saving?**
   - Check `state_module.py` Supabase connection
   - Verify environment variables
   - Check table names match

3. **Attendance not recording?**
   - Check `service_module.py` logic
   - Verify student email is being found
   - Check for duplicate record prevention

4. **Cache not working?**
   - Verify `cache_manager` is being used
   - Check cache invalidation is called
   - Look at `cache_lock` for threading issues

---

## 📞 Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| `ImportError: cannot import` | Wrong module path | Check import statement uses correct module name |
| Face not recognized | Threshold too high | Lower `FACE_VERIFICATION_THRESHOLD` |
| Database error | Connection failed | Check `SUPABASE_URL` and `SUPABASE_ANON_KEY` |
| Slow first enrollment | No cache | Second enrollment will be faster (cached) |
| Motion not detecting | Threshold too high | Lower `DEFAULT_MOTION_THRESHOLD` |

---

## 📚 Further Reading

- See `ARCHITECTURE.md` for detailed architecture
- See `ai_module.py` docstrings for face processing details
- See `service_module.py` docstrings for business logic
- See `state_module.py` docstrings for data access patterns

---

**Version:** 6.0.0-refactored  
**Created:** 2024-04-27
