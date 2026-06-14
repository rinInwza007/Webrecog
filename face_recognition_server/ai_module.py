# ==================== AI Layer ====================
# Responsible for: Face detection, Embeddings, Similarity calculations
# Dependencies: insightface, onnxruntime, opencv, numpy, sklearn
import base64
from datetime import datetime
from state_module import supabase_manager
from src.utility import parse_model_name
from src.generate_patches import CropImage
from src.anti_spoof_predict import AntiSpoofPredict
from PIL import Image
import cv2
import insightface
from insightface.app import FaceAnalysis
import numpy as np
import logging
from typing import Optional, Dict, List, Tuple
import time
import json
from sklearn.preprocessing import normalize
from sklearn.metrics.pairwise import cosine_similarity
from scipy.spatial.distance import cdist
import faiss
import threading
import sys
import os
sys.path.append(".")
logger = logging.getLogger(__name__)

# InsightFace Singleton Manager


class InsightFaceManager:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(InsightFaceManager, cls).__new__(cls)
                cls._instance.app = FaceAnalysis(name='buffalo_l', providers=[
                                                 'CPUExecutionProvider'])  # Force CPU for compatibility
                cls._instance.app.prepare(ctx_id=-1, det_size=(640, 640)) # Use -1 for CPU, smaller det_size for speed
                logger.info("🚀 InsightFace (SCRFD + ArcFace) initialized")
        return cls._instance


insightface_manager = InsightFaceManager()

MODEL = "./resources/anti_spoof_models"
model = AntiSpoofPredict(0)
# ขยายขนาดพื้นที่รอบๆใบหน้าเพื่อให้มีข้อมูลมากขึ้นสำหรับการตรวจจับ
image_cropper = CropImage()


def check_liveness(image_array):
    face_locations, image_array_redimension = FaceEmbeddingProcessor.detect_faces_in_image(
        image_array, model="hog")
    print("(top, right, bottom, left)")
    print("face_locations: ", face_locations)
    print("(หน้าที่ตรวจพบ):", len(face_locations))

    print("ขนาดภาพต้นฉบับ : ", image_array.shape)
    print("ขนาดภาพหลังออกฟังก์ชัน ค้นหาใบหน้า detect_faces_in_image : ",
          image_array_redimension.shape)

    height, width = image_array.shape[:2]  # ดึงขนาดของภาพ (สูง, กว้าง)
    max_dimension = 1024
    scale_factor = 1.0
    # ถ้าเกิน 1024 พิกเซล ให้ปรับขนาดภาพลงเพื่อให้ประมวลผลได้เร็วขึ้น
    if max(height, width) > max_dimension:
        scale_factor = max(height, width) / max_dimension

    if not face_locations:
        print("ไม่พบใบหน้าในภาพ")
        return [], [], [], image_array_redimension

    real_faces = []
    spoof_faces = []
    spoof_score_faces = []

    for idx, i in enumerate(face_locations):
        top, right, bottom, left = i

        # ปรับขนาดตำแหน่งใบหน้าตามสัดส่วนของภาพที่ถูกย่อขนาดลงเพื่อให้ไม่เกิน 1024 พิกเซล
        top = int(top * scale_factor)
        right = int(right * scale_factor)
        bottom = int(bottom * scale_factor)
        left = int(left * scale_factor)
        # แปลง format (top, right, bottom, left) → (left, top, width, height) ตามความต้องการของ CropImage
        image_bbox = [left, top, right - left, bottom - top]
        # print("image_bbox: ", image_bbox)

        print(
            f'หน้าที่ {idx}: top={top} right={right} bottom={bottom} left={left}')
        print(f'bbox: {image_bbox}')

        # BGR สำหรับ CropImage
        frame = cv2.cvtColor(image_array, cv2.COLOR_RGB2BGR)
        prediction = np.zeros((1, 3))  # array ขนาด 1x3  [[0.0, 0.0, 0.0]]

        for model_name in os.listdir(MODEL):
            # ดึงข้อมูลจากชื่อโมเดล เช่น h=128, w=128, scale=2.7  แกะจากชื่อไฟล์ 2.7_80x80_MiniFASNetV2.pth
            h, w, _, scale = parse_model_name(model_name)
            print(f'model: {model_name} | h:{h} w:{w} scale:{scale}')
            param = {
                "org_img": frame,  # คือรูปภาพ BGR ที่จะถูก crop
                # ตำแหน่งใบหน้าในรูป (left, top, width, height)
                "bbox": image_bbox,
                "scale": scale,  # ขยายขนาดพื้นที่รอบๆใบหน้า
                "out_w": w,  # ขนาดความกว้างของภาพที่ถูก crop และปรับขนาดให้ตรงกับ input ของโมเดล
                "out_h": h,  # ขนาดความสูงของภาพที่ถูก crop และปรับขนาดให้ตรงกับ input ของโมเดล
                "crop": True,  # True — crop เฉพาะส่วนหน้าออกมา False — ไม่ crop แค่ปรับขนาดทั้งภาพให้ตรงกับ input ของโมเดล
            }

            if scale is None:
                param["crop"] = False
            img_crop = image_cropper.crop(**param)
            # cv2.imwrite(f'crop_face{idx}_{model_name}.jpg', img_crop)
            prediction = prediction + \
                model.predict(img_crop, os.path.join(MODEL, model_name))
        print("prediction:", prediction)
        # หาค่าที่มีค่าสูงสุดใน prediction เพื่อระบุว่าเป็น REAL หรือ SPOOF
        label = np.argmax(prediction)
        score = float(prediction[0][label] / 2)
        print(f'label: {label} | score: {score}')
        if label == 1:  # ถ้า label เป็น 1 แสดงว่าเป็นใบหน้าจริง นอกนั้นเป็นใบหน้าปลอม
            real_faces.append(i)
        else:
            spoof_faces.append(i)
            spoof_score_faces.append(round(score, 4))
            # spoof_faces.append({"score": round(score, 2)})

    return real_faces, spoof_faces, spoof_score_faces, image_array_redimension


class FaceTracker:
    """Track faces across frames using centroid tracking"""

    def __init__(self, max_distance=50, max_disappeared=10):
        self.next_object_id = 0
        self.objects = {}
        self.disappeared = {}
        self.max_distance = max_distance
        self.max_disappeared = max_disappeared

    def register(self, centroid):
        """Register new face with ID"""
        self.objects[self.next_object_id] = centroid
        self.disappeared[self.next_object_id] = 0
        self.next_object_id += 1

    def deregister(self, object_id):
        """Deregister face"""
        del self.objects[object_id]
        del self.disappeared[object_id]

    def update(self, rects):
        """Update tracking with new face rectangles"""
        if len(rects) == 0:
            for object_id in list(self.disappeared.keys()):
                self.disappeared[object_id] += 1
                if self.disappeared[object_id] > self.max_disappeared:
                    self.deregister(object_id)
            return self.objects

        input_centroids = np.zeros((len(rects), 2), dtype="int")
        for (i, (start_x, start_y, end_x, end_y)) in enumerate(rects):
            cx = (start_x + end_x) // 2
            cy = (start_y + end_y) // 2
            input_centroids[i] = (cx, cy)

        if len(self.objects) == 0:
            for i in range(0, len(input_centroids)):
                self.register(input_centroids[i])
        else:
            object_ids = list(self.objects.keys())
            object_centroids = list(self.objects.values())

            distance = np.zeros((len(object_centroids), len(input_centroids)))
            for i in range(len(object_centroids)):
                for j in range(len(input_centroids)):
                    distance[i][j] = np.linalg.norm(
                        np.array(object_centroids[i]) - input_centroids[j])

            rows = distance.min(axis=1).argsort()
            cols = distance.argmin(axis=1)[rows]

            used_rows = set()
            used_cols = set()

            for (row, col) in zip(rows, cols):
                if row in used_rows or col in used_cols:
                    continue
                if distance[row, col] > self.max_distance:
                    continue

                object_id = object_ids[row]
                self.objects[object_id] = input_centroids[col]
                self.disappeared[object_id] = 0

                used_rows.add(row)
                used_cols.add(col)

            unused_rows = set(
                range(0, distance.shape[0])).difference(used_rows)
            unused_cols = set(
                range(0, distance.shape[1])).difference(used_cols)

            if distance.shape[0] >= distance.shape[1]:
                for row in unused_rows:
                    object_id = object_ids[row]
                    self.disappeared[object_id] += 1
                    if self.disappeared[object_id] > self.max_disappeared:
                        self.deregister(object_id)
            else:
                for col in unused_cols:
                    self.register(input_centroids[col])

        return self.objects


class FAISSEmbeddingIndex:
    """Fast similarity search using FAISS"""

    def __init__(self, embedding_dim=128):
        self.embedding_dim = embedding_dim
        self.index = faiss.IndexFlatL2(embedding_dim)
        self.id_map = {}
        self.next_id = 0
        self.lock = threading.Lock()

    def add_embedding(self, student_id: str, embedding: np.ndarray) -> int:
        """Add embedding to index"""
        with self.lock:
            embedding_normalized = embedding.reshape(1, -1).astype('float32')
            self.index.add(embedding_normalized)
            self.id_map[self.next_id] = student_id
            self.next_id += 1
            return self.next_id - 1

    def search(self, embedding: np.ndarray, k=5, threshold=0.6) -> List[Dict]:
        """Search for similar embeddings"""
        try:
            with self.lock:
                if self.index.ntotal == 0:
                    return []

                embedding_normalized = embedding.reshape(
                    1, -1).astype('float32')
                distances, indices = self.index.search(embedding_normalized, k)

                results = []
                for idx, distance in zip(indices[0], distances[0]):
                    # Convert L2 distance to similarity score
                    similarity = 1 / (1 + distance)
                    if similarity >= threshold:
                        results.append({
                            'student_id': self.id_map.get(idx, 'unknown'),
                            'similarity': float(similarity),
                            'distance': float(distance)
                        })

                return sorted(results, key=lambda x: x['similarity'], reverse=True)
        except Exception as e:
            logger.error(f"Error searching FAISS index: {e}")
            return []

    def clear(self):
        """Clear index"""
        with self.lock:
            self.index.reset()
            self.id_map.clear()
            self.next_id = 0


class FaceEmbeddingProcessor:
    """Handle face detection, embedding extraction, and quality assessment using InsightFace"""

    @staticmethod
    def normalize_embedding(embedding: np.ndarray) -> Optional[np.ndarray]:
        """Normalize embedding to unit vector for stable comparison"""
        try:
            if embedding is None or embedding.size == 0:
                return None

            norm = np.linalg.norm(embedding)
            if norm == 0:
                logger.warning("Zero norm embedding detected")
                return embedding

            normalized = embedding / norm
            return normalized.astype(np.float64)

        except Exception as e:
            logger.error(f"Error normalizing embedding: {e}")
            return embedding

    @staticmethod
    def detect_faces_in_image(image_array: np.ndarray, model: str = "auto", motion_strength: float = 0.5) -> Tuple[List[Tuple], np.ndarray]:
        """
        Detect faces in image using SCRFD (InsightFace)
        Returns: (face_locations, processed_image)
        face_locations format: [(top, right, bottom, left), ...] for compatibility
        """
        try:
            if image_array is None or image_array.size == 0:
                return [], image_array

            # Optimize image if too large
            height, width = image_array.shape[:2]
            max_dimension = 1024
            processed_image = image_array

            if max(height, width) > max_dimension:
                scale = max_dimension / max(height, width)
                new_width = int(width * scale)
                new_height = int(height * scale)
                processed_image = cv2.resize(
                    image_array, (new_width, new_height))
                logger.debug(
                    f"🔧 Resized image for detection: {width}x{height} → {new_width}x{new_height}")

            # InsightFace expects BGR
            bgr_image = cv2.cvtColor(processed_image, cv2.COLOR_RGB2BGR)
            
            # Detect faces using SCRFD
            faces = insightface_manager.app.get(bgr_image)

            face_locations = []
            for face in faces:
                bbox = face.bbox.astype(int)
                # Convert [x1, y1, x2, y2] to (top, right, bottom, left)
                face_locations.append((bbox[1], bbox[2], bbox[3], bbox[0]))

            logger.info(f"👥 Detected {len(face_locations)} faces using SCRFD")
            return face_locations, processed_image

        except Exception as e:
            logger.error(f"Error detecting faces with SCRFD: {e}")
            return [], image_array

    @staticmethod
    def extract_face_encodings(image_array: np.ndarray, face_locations: List[Tuple] = None,
                               num_jitters: int = 1) -> List[np.ndarray]:
        """
        Extract face encodings from detected faces using ArcFace (InsightFace)
        If face_locations is provided, we use them to identify which faces to encode.
        Actually InsightFace's app.get() does both. If we already have image_array, 
        we'll just call app.get again or re-use if possible.
        To maintain compatibility with the existing flow:
        """
        try:
            # ArcFace usually works better on aligned faces, which app.get() handles.
            faces = insightface_manager.app.get(image_array)
            encodings = [face.normed_embedding for face in faces]

            logger.debug(f"🧠 Extracted {len(encodings)} ArcFace embeddings")
            return encodings

        except Exception as e:
            logger.error(f"Error extracting ArcFace encodings: {e}")
            return []

    @staticmethod
    def calculate_face_quality(image_array: np.ndarray, face_location: Tuple) -> Dict[str, float]:
        """Calculate comprehensive face quality metrics"""
        try:
            top, right, bottom, left = face_location
            face_height = bottom - top
            face_width = right - left

            # Extract face region
            face_region = image_array[top:bottom, left:right]

            # Quality metrics
            metrics = {}

            # 1. Face size (larger = better)
            image_area = image_array.shape[0] * image_array.shape[1]
            face_area = face_height * face_width
            size_score = min(1.0, (face_area / image_area) * 10)
            metrics['size_score'] = size_score

            # 2. Face aspect ratio (closer to 1.0 = frontal face)
            aspect_ratio = face_width / face_height if face_height > 0 else 0
            aspect_score = 1.0 - abs(aspect_ratio - 1.0)
            aspect_score = max(0.0, min(1.0, aspect_score))
            metrics['aspect_ratio_score'] = aspect_score

            # 3. Sharpness/Blur using Laplacian
            if len(face_region.shape) == 3:
                gray_face = cv2.cvtColor(face_region, cv2.COLOR_RGB2GRAY)
            else:
                gray_face = face_region

            laplacian = cv2.Laplacian(gray_face, cv2.CV_64F)
            sharpness_score = laplacian.var()
            # Raw sharpness score for DB
            metrics['blur_score'] = float(sharpness_score)
            
            # Normalized sharpness for overall quality
            norm_sharpness = min(1.0, sharpness_score / 100)
            metrics['sharpness_score'] = norm_sharpness

            # 4. Lighting quality (not too dark, not too bright)
            mean_brightness = np.mean(gray_face)
            metrics['brightness_score'] = float(mean_brightness)
            
            brightness_quality = 1.0 - abs(mean_brightness - 127.5) / 127.5
            brightness_quality = max(0.0, brightness_quality)
            metrics['brightness_quality_score'] = brightness_quality

            # Overall quality (weighted average)
            overall_score = (
                size_score * 0.25 +
                aspect_score * 0.25 +
                norm_sharpness * 0.3 +
                brightness_quality * 0.2
            )

            metrics['overall_score'] = overall_score
            return metrics

        except Exception as e:
            logger.error(f"Error calculating face quality: {e}")
            return {'overall_score': 0.5, 'blur_score': 0.0, 'brightness_score': 0.0}

    @staticmethod
    def analyze_face_for_enrollment(image_array: np.ndarray) -> Optional[Dict]:
        """Comprehensive analysis of a single face for enrollment"""
        try:
            if image_array is None or image_array.size == 0:
                return None

            # Optimize image if too large (consistent with detect_faces_in_image)
            height, width = image_array.shape[:2]
            max_dimension = 1024
            processed_image = image_array
            scale = 1.0

            if max(height, width) > max_dimension:
                scale = max_dimension / max(height, width)
                new_width = int(width * scale)
                new_height = int(height * scale)
                processed_image = cv2.resize(image_array, (new_width, new_height))
                logger.info(f"🔧 Resized enrollment image: {width}x{height} → {new_width}x{new_height}")

            # InsightFace expects BGR
            bgr_image = cv2.cvtColor(processed_image, cv2.COLOR_RGB2BGR)

            faces = insightface_manager.app.get(bgr_image)
            if not faces:
                logger.warning(f"❌ No faces detected in enrollment image ({width}x{height})")
                return None

            # Take the primary face (largest bbox)
            face = sorted(faces, key=lambda x: (x.bbox[2]-x.bbox[0])*(x.bbox[3]-x.bbox[1]), reverse=True)[0]
            
            # Map bbox back to original scale if resized
            bbox = face.bbox
            if scale != 1.0:
                bbox = bbox / scale
                
            bbox = bbox.astype(int)
            location = (bbox[1], bbox[2], bbox[3], bbox[0]) # top, right, bottom, left
            
            # Quality metrics should be calculated on the original high-res face region if possible,
            # but for consistency and since calculate_face_quality takes image_array, 
            # we'll use the original image_array with the scaled bbox.
            quality_metrics = FaceEmbeddingProcessor.calculate_face_quality(image_array, location)
            
            logger.info(f"✅ Detected face for enrollment: det_score={face.det_score:.4f}, pose={face.pose}")

            return {
                'embedding': face.normed_embedding,
                'location': location,
                'detection_score': float(face.det_score),
                'pose_angles': {
                    'pitch': float(face.pose[0]),
                    'yaw': float(face.pose[1]),
                    'roll': float(face.pose[2])
                },
                'quality': quality_metrics
            }

        except Exception as e:
            logger.error(f"Error in analyze_face_for_enrollment: {e}", exc_info=True)
            return None


class SimilarityCalculator:
    """Calculate and compare face embeddings using Cosine Similarity"""

    @staticmethod
    def calculate_advanced_similarity(embedding1: np.ndarray, embedding2: np.ndarray) -> Dict[str, float]:
        """
        Simplified similarity calculation using only Cosine Similarity (requested)
        """
        try:
            # Normalize both embeddings
            norm_emb1 = FaceEmbeddingProcessor.normalize_embedding(embedding1)
            norm_emb2 = FaceEmbeddingProcessor.normalize_embedding(embedding2)

            if norm_emb1 is None or norm_emb2 is None:
                return {
                    'cosine_similarity': 0.0,
                    'combined_score': 0.0,
                    'confidence_level': 'error'
                }

            # Cosine Similarity
            cosine_sim = np.dot(norm_emb1, norm_emb2)
            cosine_sim = np.clip(float(cosine_sim), -1.0, 1.0)

            # Confidence assessment (ArcFace usually has higher scores, 0.4-0.6 is common threshold)
            if cosine_sim > 0.7:
                confidence_level = 'very_high'
            elif cosine_sim > 0.5:
                confidence_level = 'high'
            elif cosine_sim > 0.4:
                confidence_level = 'medium'
            elif cosine_sim > 0.3:
                confidence_level = 'low'
            else:
                confidence_level = 'very_low'

            return {
                'cosine_similarity': cosine_sim,
                'combined_score': cosine_sim,
                'confidence_level': confidence_level
            }

        except Exception as e:
            logger.error(f"Error calculating similarity: {e}")
            return {
                'cosine_similarity': 0.0,
                'combined_score': 0.0,
                'confidence_level': 'error'
            }

    @staticmethod
    def calculate_simple_similarity(embedding1: np.ndarray, embedding2: np.ndarray) -> float:
        """Simple cosine similarity for quick comparison"""
        try:
            norm_emb1 = FaceEmbeddingProcessor.normalize_embedding(embedding1)
            norm_emb2 = FaceEmbeddingProcessor.normalize_embedding(embedding2)

            if norm_emb1 is None or norm_emb2 is None:
                return 0.0

            return float(np.dot(norm_emb1, norm_emb2))
        except Exception as e:
            logger.error(f"Error calculating simple similarity: {e}")
            return 0.0


class AdvancedFaceEmbeddingManager:
    """Advanced face embedding management with the new schema (enrollments -> embeddings)"""

    def __init__(self, supabase_client=None, cache_manager=None):
        self.supabase_client = supabase_client
        self.cache_manager = cache_manager

    def _get_pose_label(self, yaw: float, pitch: float, roll: float) -> str:
        """Map yaw and pitch angles to a descriptive pose label"""
        # Threshold for considering a pose non-frontal
        threshold = 15.0
        
        yaw_label = ""
        if yaw > threshold:
            yaw_label = "right"
        elif yaw < -threshold:
            yaw_label = "left"
            
        pitch_label = ""
        if pitch > threshold:
            pitch_label = "down" # InsightFace pitch: positive is down, negative is up
        elif pitch < -threshold:
            pitch_label = "up"
            
        if not yaw_label and not pitch_label:
            return "front"
        elif yaw_label and pitch_label:
            return f"{yaw_label}_{pitch_label}"
        else:
            return yaw_label or pitch_label

    def save_multiple_embeddings(self, student_id: str, embeddings: List[np.ndarray],
                             metadata_list: List[Dict], method: str = 'all_separate') -> bool:
        """
        Save multiple embeddings with detailed metadata to the new schema
        metadata_list contains dicts with: quality, pose_angles, detection_score, etc.
        """
        try:
            if not embeddings or len(embeddings) == 0:
                logger.error(f"No embeddings provided for {student_id}")
                return False

            logger.info(f"🎯 Saving {len(embeddings)} ArcFace embeddings for {student_id} to new schema (advanced)")

            if not self.supabase_client:
                return False

            # Calculate average quality and detection scores for the enrollment record
            qualities = [m['quality']['overall_score'] for m in metadata_list]
            det_scores = [m['detection_score'] for m in metadata_list]
            avg_quality = float(np.mean(qualities)) if qualities else 0.0
            avg_det_score = float(np.mean(det_scores)) if det_scores else 0.0

            # Step 1: Deactivate previous enrollments
            self.supabase_client.get_client().table('student_face_enrollments').update({
                'is_active': False,
                'updated_at': datetime.now().isoformat()
            }).eq('student_id', student_id).execute()

            # Step 2: Create new enrollment
            enrollment_data = {
                'student_id': student_id,
                'enrollment_type': 'multiple_angles_advanced',
                'system_version': 'if_v1',
                'motion_optimized': True,
                'is_active': True,
                'avg_quality_score': round(avg_quality, 3),
                'avg_detection_score': round(avg_det_score, 4),
                'total_embeddings': len(embeddings),
                'original_count': len(embeddings),
                'embedding_model': 'insightface_arcface_buffalo_l',
                'created_at': datetime.now().isoformat(),
                'updated_at': datetime.now().isoformat()
            }

            enrollment_result = self.supabase_client.get_client()\
                .table('student_face_enrollments').insert(enrollment_data).execute()

            if not enrollment_result.data:
                logger.error(f"Failed to create enrollment record for {student_id}")
                return False

            enrollment_id = enrollment_result.data[0]['id']
            logger.info(f"✅ Created enrollment id={enrollment_id} for {student_id}")

            # Step 3: Save embeddings
            for i, (embedding, meta) in enumerate(zip(embeddings, metadata_list)):
                norm_embedding = FaceEmbeddingProcessor.normalize_embedding(embedding)
                if norm_embedding is None:
                    continue

                # Automatic pose labeling
                angles = meta['pose_angles']
                pose_label = self._get_pose_label(angles['yaw'], angles['pitch'], angles['roll'])
                
                # Quality details
                q = meta['quality']

                embedding_record = {
                    'enrollment_id': enrollment_id,
                    'student_id': student_id,
                    'pose': pose_label,
                    'embedding_model': 'insightface_arcface_buffalo_l',
                    'face_embedding': str(norm_embedding.tolist()),
                    'face_quality': round(float(q['overall_score']), 3),
                    'blur_score': round(float(q.get('blur_score', 0.0)), 3),
                    'brightness_score': round(float(q.get('brightness_score', 0.0)), 3),
                    'yaw_angle': round(float(angles['yaw']), 2),
                    'pitch_angle': round(float(angles['pitch']), 2),
                    'roll_angle': round(float(angles['roll']), 2),
                    'detection_score': round(float(meta['detection_score']), 4),
                    'metadata_json': {'angle_index': i, 'pose_details': angles},
                    'created_at': datetime.now().isoformat(),
                    'updated_at': datetime.now().isoformat()
                }

                result = self.supabase_client.get_client()\
                    .table('student_face_embeddings').insert(embedding_record).execute()

                if not result.data:
                    logger.error(f"❌ Insert failed for pose={pose_label}: {result}")
                else:
                    logger.info(f"✅ Inserted embedding pose={pose_label}, id={result.data[0]['id']}")

            # Step 4: Invalidate cache
            if self.cache_manager:
                self.cache_manager.invalidate_student_cache(student_id)

            logger.info(f"✅ Successfully enrolled student {student_id} with {len(embeddings)} angles")
            return True

        except Exception as e:
            import traceback
            traceback.print_exc()
            logger.error(f"Error in save_multiple_embeddings (advanced): {e}")
            return False

    def get_all_embeddings_for_student(self, student_id: str) -> List[np.ndarray]:
        """Retrieve all active embeddings for a student using the enrollment join"""
        try:
            # Check cache first
            if self.cache_manager:
                cached = self.cache_manager.get_embedding_cache(student_id)
                if isinstance(cached, list):
                    return cached

            if not self.supabase_client:
                return []

            # Find the active enrollment ID first
            enrollment_result = self.supabase_client.get_client().table('student_face_enrollments')\
                .select('id')\
                .eq('student_id', student_id)\
                .eq('is_active', True)\
                .single()\
                .execute()

            if not enrollment_result.data:
                logger.warning(f"No active enrollment found for {student_id}")
                return []

            enrollment_id = enrollment_result.data['id']

            # Get all embeddings for this enrollment
            result = self.supabase_client.get_client().table('student_face_embeddings')\
                .select('face_embedding')\
                .eq('enrollment_id', enrollment_id)\
                .execute()

            if not result.data:
                logger.error(f"❌ Insert failed for pose={pose}: {result}")
            else:
                logger.info(
                    f"✅ Retrieved {len(result.data)} embeddings for {student_id} from new schema")

            embeddings = []
            for record in result.data:
                # face_embedding should come back as a list from pgvector
                emb_data = record['face_embedding']
                if isinstance(emb_data, str):
                    # Handle if it comes back as string like "[1,2,3]"
                    emb_data = json.loads(emb_data.replace("'", '"'))

                emb = np.array(emb_data, dtype=np.float64)
                embeddings.append(emb)

            # Cache the list
            if self.cache_manager and embeddings:
                self.cache_manager.set_embedding_cache(student_id, embeddings)

            return embeddings
        except Exception as e:
            logger.error(
                f"Error fetching all embeddings for {student_id} (new schema): {e}")
            return []

    def get_embedding_advanced(self, student_id: str) -> Optional[np.ndarray]:
        """Legacy compatibility"""
        embs = self.get_all_embeddings_for_student(student_id)
        return embs[0] if embs else None


def process_faces_with_advanced_matching(session_id: str, image_array: np.ndarray, enrolled_students: List[str],  # image_array: np.ndarray รูปเต็ม
                                         config: Dict, motion_strength: float = 0.5,
                                         embedding_manager=None, use_advanced_similarity: bool = True) -> List[Dict]:
    """Face processing with advanced similarity calculation"""
    try:
        start_time = time.time()

        if image_array is None or image_array.size == 0:
            logger.warning("Empty image array")
            return {
                'detected_faces': [],
                'spoof_detected': False,
                'spoof_count': 0,
                'spoof_timestamp': None,
                'spoof_image_b64': None
            }

        if not enrolled_students:
            logger.warning("⚠️ No students → running detection-only mode")

        face_locations_real = []

        logger.info(
            f"🔍 Advanced processing with {len(enrolled_students)} enrolled students")

        # Detect faces แคปชันการตรวจจับใบหน้าพร้อมการเลือกโมเดลแบบไดนามิก
        # face_locations = FaceEmbeddingProcessor.detect_faces_in_image(image_array, model="hog") #ใช้ฟังชัน detect_faces_in_image จากไฟล์ ai_module.py ในการตรวจจับใบหน้า โดยใช้โมเดล HOG
        # ค้นหาใบหน้าที่ตรวจจับได้และแยกแยะระหว่างใบหน้าจริงและใบหน้าปลอม (spoof) โดยใช้ฟังก์ชัน check_liveness ซึ่งจะคืนค่าเป็นสองรายการ: face_locations_real สำหรับใบหน้าจริง และ face_locations_spoof สำหรับใบหน้าปลอม
        face_locations_real, face_locations_spoof, spoof_scores, image_array_redimension = check_liveness(
            image_array)
        # ได้ลิส โลเคชันใบหน้าออกมา
        print("result_real:", face_locations_real)
        print("result_spoof:", face_locations_spoof)
        print("spoof_scores:", spoof_scores)
        len_spoof = len(face_locations_spoof)
        print("จำนวนหน้าปลอม:", len_spoof)
        spoof_image_b64 = None
        spoof_timestamp = None

        if len_spoof > 0:
            print("พบใบหน้าปลอมจำนวน:", len_spoof)
            print("session_id:", session_id)
            supabase_manager.liveness_log(len_spoof, session_id)

            image_draw = image_array_redimension.copy()
            # mage_draw = cv2.cvtColor(image_draw, cv2.COLOR_RGB2BGR)
            for (top, right, bottom, left) in face_locations_spoof:
                cv2.rectangle(image_draw, (left, top),
                              (right, bottom), (255, 0, 0), 3)
                cv2.putText(image_draw, "SPOOF", (left, top - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 0, 0), 2)
            # filename = f"spoof_{session_id}.jpg"
            # cv2.imwrite(filename, image_draw)

            # แปลงภาพจาก RGB เป็น BGR เพื่อให้ OpenCV สามารถบันทึกได้ถูกต้อง
            img_bgr = cv2.cvtColor(image_draw, cv2.COLOR_RGB2BGR)
            # บีบอัดภาพเป็น JPEG และเก็บไว้ใน buffer
            _, buffer = cv2.imencode(
                '.jpg', img_bgr, [cv2.IMWRITE_JPEG_QUALITY, 85])
            spoof_image_b64 = base64.b64encode(buffer).decode(
                'utf-8')  # แปลง buffer เป็น Base64 string
            spoof_timestamp = datetime.now().isoformat()
            print("สร้าง spoof image แล้ว:")

        if not face_locations_real:
            logger.info("❌ No face_locations_real detected")

        face_encodings = []
        detected_faces = []
        if len(face_locations_real) > 0:
            # Extract encodings # สร้าง embedding
            # ใช้ฟังชัน extract_face_encodings จากไฟล์ ai_module.py ในการแปลงใบหน้าที่ตรวจจับได้เป็นเวกเตอร์ตัวเลขที่เรียกว่า "face encoding" ซึ่งจะใช้ในการเปรียบเทียบกับข้อมูลใบหน้าที่ลงทะเบียนไว้ในระบบ
            face_encodings = FaceEmbeddingProcessor.extract_face_encodings(
                image_array, face_locations_real, num_jitters=2)

            if len(face_encodings) > 0:
                logger.warning(" ✅have face encodings generated")
            else:
                logger.warning(" ❌ No face encodings generated")

            detected_faces = []
            base_threshold = config.get('face_threshold', 0.6)

            # วนลูปผ่านใบหน้าที่ตรวจจับได้และการเข้ารหัสที่สอดคล้องกัน
            for i, (encoding, location) in enumerate(zip(face_encodings, face_locations_real)):
                face_identification_start = time.time()
                logger.info(f"🔍 Processing face {i+1}/{len(face_encodings)}")

                norm_encoding = FaceEmbeddingProcessor.normalize_embedding(
                    encoding)
                if norm_encoding is None:
                    continue

                # Max Similarity matching across all students
                similarity_results = []

                for student_id in enrolled_students:
                    if not embedding_manager:
                        continue

                    fetch_start = time.time()
                    # Get ALL stored embeddings for this student (multiple angles)
                    stored_embeddings = embedding_manager.get_all_embeddings_for_student(
                        student_id)
                    fetch_duration = time.time() - fetch_start

                    if not stored_embeddings:
                        continue

                    # MAX SIMILARITY LOGIC: Compare against every angle and take the highest score
                    max_student_sim = -1.0
                    best_metrics = None

                    for stored_emb in stored_embeddings:
                        sim_metrics = SimilarityCalculator.calculate_advanced_similarity(
                            norm_encoding, stored_emb)
                        if sim_metrics['combined_score'] > max_student_sim:
                            max_student_sim = sim_metrics['combined_score']
                            best_metrics = sim_metrics

                    similarity_results.append({
                        'student_id': student_id,
                        'similarity_score': max_student_sim,
                        'confidence_level': best_metrics.get('confidence_level', 'medium'),
                        'detailed_metrics': best_metrics,
                        'fetch_time_ms': fetch_duration * 1000
                    })

                # Sort by similarity to find the winner among students
                similarity_results.sort(
                    key=lambda x: x['similarity_score'], reverse=True)

                # Determine best match
                best_match = None
                best_score = 0.0
                confidence_level = 'very_low'
                # ArcFace threshold is typically lower (e.g., 0.45)
                threshold = config.get('face_threshold', 0.45)

                if similarity_results:
                    top_result = similarity_results[0]

                    # Adaptive threshold (slightly more lenient for very high confidence angles)
                    if top_result['confidence_level'] == 'very_high':
                        effective_threshold = threshold * 0.9
                    else:
                        effective_threshold = threshold

                    if top_result['similarity_score'] > effective_threshold:
                        best_match = top_result['student_id']
                        best_score = top_result['similarity_score']
                        confidence_level = top_result['confidence_level']
                        logger.info(
                            f"✅ Recognized {best_match} with score {best_score:.4f} (Max Sim)")

                identification_time = time.time() - face_identification_start

                face_info = {
                    'face_index': i,
                    'student_id': best_match,
                    'confidence': float(best_score),
                    'verified': best_match is not None,
                    'confidence_level': confidence_level,
                    'threshold_used': threshold,
                    'advanced_analysis': similarity_results[:5],
                    'bounding_box': {
                        'top': int(location[0]),
                        'right': int(location[1]),
                        'bottom': int(location[2]),
                        'left': int(location[3])
                    },
                    'processing_method': 'arcface_max_similarity',
                    'motion_strength': motion_strength,
                    'identification_time_s': identification_time
                }

                detected_faces.append(face_info)

        processing_time = time.time() - start_time
        verified_count = len([f for f in detected_faces if f['verified']])

        logger.info(
            f"📋 Advanced processing complete: {verified_count} recognized in {processing_time:.2f}s")

        return {
            'detected_faces': detected_faces,
            'spoof_detected': len_spoof > 0,
            'spoof_count': len_spoof,
            'spoof_timestamp': spoof_timestamp,
            'spoof_image_b64': spoof_image_b64
        }

    except Exception as e:
        logger.error(f"Error in advanced face processing: {e}")
        return []
