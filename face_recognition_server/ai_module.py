# ==================== AI Layer ====================
# Responsible for: Face detection, Embeddings, Similarity calculations
# Dependencies: face_recognition, opencv, numpy, sklearn

import cv2
import face_recognition
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

logger = logging.getLogger(__name__)


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
                    distance[i][j] = np.linalg.norm(np.array(object_centroids[i]) - input_centroids[j])
            
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
            
            unused_rows = set(range(0, distance.shape[0])).difference(used_rows)
            unused_cols = set(range(0, distance.shape[1])).difference(used_cols)
            
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
                
                embedding_normalized = embedding.reshape(1, -1).astype('float32')
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
    """Handle face detection, embedding extraction, and quality assessment"""
    
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
    def detect_faces_in_image(image_array: np.ndarray, model: str = "auto", motion_strength: float = 0.5) -> List[Tuple]:
        """
        Detect faces in image with dynamic model selection
        model: "hog" (fast), "cnn" (accurate), or "auto" (dynamic)
        motion_strength: 0-1, affects model selection when auto
        """
        try:
            if image_array is None or image_array.size == 0:
                return []
            
            # Dynamic model selection
            if model == "auto":
                # High motion -> use fast HOG; Low motion -> use accurate CNN
                model = "cnn" if motion_strength < 0.6 else "hog"
                logger.debug(f"🔄 Dynamic model switch: motion={motion_strength:.2f} → {model}")
            
            # Optimize image if too large
            height, width = image_array.shape[:2]
            max_dimension = 1024
            
            if max(height, width) > max_dimension:
                scale = max_dimension / max(height, width)
                new_width = int(width * scale)
                new_height = int(height * scale)
                image_array = cv2.resize(image_array, (new_width, new_height))
                logger.debug(f"🔧 Resized image: {width}x{height} → {new_width}x{new_height}")
            
            face_locations = face_recognition.face_locations(image_array, model=model)
            logger.info(f"👥 Detected {len(face_locations)} faces using {model} model")
            return face_locations
            
        except Exception as e:
            logger.error(f"Error detecting faces: {e}")
            return []
    
    @staticmethod
    def extract_face_encodings(image_array: np.ndarray, face_locations: List[Tuple],
                              num_jitters: int = 1) -> List[np.ndarray]:
        """Extract face encodings from detected faces"""
        try:
            if not face_locations:

                return []
            
            encodings = face_recognition.face_encodings(image_array, face_locations, num_jitters=num_jitters)
            logger.debug(f"🧠 Extracted {len(encodings)} face encodings")
            return encodings
            
        except Exception as e:
            logger.error(f"Error extracting encodings: {e}")
            return []
    
    @staticmethod
    def extract_face_encodings_lazy(image_array: np.ndarray, face_locations: List[Tuple],
                                   quality_threshold: float = 0.3, num_jitters: int = 1) -> Dict[str, any]:
        """
        Lazy face encoding: Check quality first, then only encode good faces
        Returns: {'encodings': [...], 'qualities': [...], 'skipped': count}
        """
        try:
            if not face_locations:
                return {'encodings': [], 'qualities': [], 'skipped': 0}
            
            qualities = []
            valid_locations = []
            valid_indices = []
            skipped = 0
            
            # First pass: quality filtering
            for i, location in enumerate(face_locations):
                quality = FaceEmbeddingProcessor.calculate_face_quality(image_array, location)
                overall_quality = quality.get('overall_quality', 0)
                
                if overall_quality >= quality_threshold:
                    valid_locations.append(location)
                    qualities.append(overall_quality)
                    valid_indices.append(i)
                else:
                    skipped += 1
                    logger.debug(f"⏭️  Skipped low-quality face (quality={overall_quality:.2f})")
            
            # Second pass: encoding only high-quality faces
            if valid_locations:
                encodings = face_recognition.face_encodings(image_array, valid_locations, num_jitters=num_jitters)
                logger.info(f"🧠 Lazy extracted {len(encodings)} faces (quality filter skipped {skipped})")
                return {
                    'encodings': encodings,
                    'qualities': qualities,
                    'indices': valid_indices,
                    'skipped': skipped
                }
            
            return {'encodings': [], 'qualities': [], 'indices': [], 'skipped': skipped}
            
        except Exception as e:
            logger.error(f"Error in lazy encoding: {e}")
            return {'encodings': [], 'qualities': [], 'indices': [], 'skipped': 0}
    
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
            
            # 3. Brightness/Contrast using Laplacian (edge detection)
            if len(face_region.shape) == 3:
                gray_face = cv2.cvtColor(face_region, cv2.COLOR_RGB2GRAY)
            else:
                gray_face = face_region
            
            laplacian = cv2.Laplacian(gray_face, cv2.CV_64F)
            sharpness_score = laplacian.var()
            sharpness_score = min(1.0, sharpness_score / 100)
            metrics['sharpness_score'] = sharpness_score
            
            # 4. Lighting quality (not too dark, not too bright)
            mean_brightness = np.mean(gray_face)
            brightness_score = 1.0 - abs(mean_brightness - 127.5) / 127.5
            brightness_score = max(0.0, brightness_score)
            metrics['brightness_score'] = brightness_score
            
            # Overall quality (weighted average)
            overall_score = (
                size_score * 0.25 +
                aspect_score * 0.25 +
                sharpness_score * 0.3 +
                brightness_score * 0.2
            )
            
            metrics['overall_score'] = overall_score
            return metrics
            
        except Exception as e:
            logger.error(f"Error calculating face quality: {e}")
            return {'overall_score': 0.5}


class SimilarityCalculator:
    """Calculate and compare face embeddings"""
    
    @staticmethod
    def calculate_advanced_similarity(embedding1: np.ndarray, embedding2: np.ndarray) -> Dict[str, float]:
        """
        Advanced similarity calculation with multiple metrics
        Returns comprehensive similarity analysis
        """
        try:
            # Normalize both embeddings
            norm_emb1 = FaceEmbeddingProcessor.normalize_embedding(embedding1)
            norm_emb2 = FaceEmbeddingProcessor.normalize_embedding(embedding2)
            
            if norm_emb1 is None or norm_emb2 is None:
                return {
                    'cosine_similarity': 0.0,
                    'euclidean_distance': 2.0,
                    'euclidean_similarity': 0.0,
                    'manhattan_distance': 2.0,
                    'combined_score': 0.0,
                    'confidence_level': 'error'
                }
            
            # 1. Cosine Similarity (most reliable for face embeddings)
            cosine_sim = np.dot(norm_emb1, norm_emb2)
            cosine_sim = np.clip(cosine_sim, -1.0, 1.0)
            
            # 2. Euclidean Distance
            euclidean_dist = np.linalg.norm(norm_emb1 - norm_emb2)
            euclidean_similarity = max(0.0, (2.0 - euclidean_dist) / 2.0)
            
            # 3. Manhattan Distance
            manhattan_dist = np.sum(np.abs(norm_emb1 - norm_emb2))
            manhattan_similarity = max(0.0, (2.0 - manhattan_dist) / 2.0)
            
            # 4. Weighted combination
            combined_score = (
                cosine_sim * 0.6 +
                euclidean_similarity * 0.3 +
                manhattan_similarity * 0.1
            )
            
            # 5. Confidence assessment
            if combined_score > 0.85:
                confidence_level = 'very_high'
            elif combined_score > 0.75:
                confidence_level = 'high'
            elif combined_score > 0.65:
                confidence_level = 'medium'
            elif combined_score > 0.5:
                confidence_level = 'low'
            else:
                confidence_level = 'very_low'
            
            return {
                'cosine_similarity': float(cosine_sim),
                'euclidean_distance': float(euclidean_dist),
                'euclidean_similarity': float(euclidean_similarity),
                'manhattan_distance': float(manhattan_dist),
                'manhattan_similarity': float(manhattan_similarity),
                'combined_score': float(combined_score),
                'confidence_level': confidence_level
            }
            
        except Exception as e:
            logger.error(f"Error calculating advanced similarity: {e}")
            return {
                'cosine_similarity': 0.0,
                'euclidean_distance': 2.0,
                'euclidean_similarity': 0.0,
                'manhattan_distance': 2.0,
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
    """Advanced face embedding management with multiple embeddings per person"""
    
    def __init__(self, supabase_client=None, cache_manager=None):
        self.supabase_client = supabase_client
        self.cache_manager = cache_manager
    
    def save_multiple_embeddings(self, student_id: str, embeddings: List[np.ndarray],
                                qualities: List[float], method: str = 'weighted_centroid') -> bool:
        """
        Save multiple face embeddings for one person
        Methods: 'weighted_centroid', 'best_quality', 'all_separate', 'quality_filtered'
        """
        try:
            if not embeddings or len(embeddings) == 0:
                logger.error(f"No embeddings provided for {student_id}")
                return False
            
            logger.info(f"🎯 Saving {len(embeddings)} embeddings for {student_id} using {method}")
            
            # Normalize all embeddings
            normalized_embeddings = []
            valid_qualities = []
            
            for i, (embedding, quality) in enumerate(zip(embeddings, qualities)):
                norm_embedding = FaceEmbeddingProcessor.normalize_embedding(embedding)
                if norm_embedding is not None:
                    normalized_embeddings.append(norm_embedding)
                    valid_qualities.append(quality)
                else:
                    logger.warning(f"Failed to normalize embedding {i+1} for {student_id}")
            
            if not normalized_embeddings:
                logger.error(f"No valid normalized embeddings for {student_id}")
                return False
            
            # Apply method-specific processing
            if method == 'weighted_centroid':
                final_embedding, metadata = self._create_weighted_centroid(normalized_embeddings, valid_qualities)
            elif method == 'best_quality':
                final_embedding, metadata = self._select_best_quality(normalized_embeddings, valid_qualities)
            elif method == 'quality_filtered':
                final_embedding, metadata = self._quality_filtered_centroid(normalized_embeddings, valid_qualities)
            elif method == 'all_separate':
                return self._save_separate_embeddings(student_id, normalized_embeddings, valid_qualities)
            else:
                final_embedding = normalized_embeddings[0]
                metadata = {'method': 'single', 'source_count': 1}
            
            # Save to database
            return self._save_embedding_to_db(student_id, final_embedding, np.mean(valid_qualities), metadata)
            
        except Exception as e:
            logger.error(f"Error saving multiple embeddings for {student_id}: {e}")
            return False
    
    def _create_weighted_centroid(self, embeddings: List[np.ndarray],
                                 qualities: List[float]) -> Tuple[np.ndarray, Dict]:
        """Create quality-weighted centroid of embeddings"""
        try:
            embeddings_matrix = np.array(embeddings)
            weights = np.array(qualities)
            weights = weights / np.sum(weights)
            
            centroid = np.average(embeddings_matrix, axis=0, weights=weights)
            final_embedding = FaceEmbeddingProcessor.normalize_embedding(centroid)
            
            metadata = {
                'method': 'weighted_centroid',
                'source_count': len(embeddings),
                'quality_weights': weights.tolist(),
                'average_quality': float(np.mean(qualities)),
                'quality_std': float(np.std(qualities))
            }
            
            return final_embedding, metadata
        except Exception as e:
            logger.error(f"Error creating weighted centroid: {e}")
            return embeddings[0], {'method': 'fallback'}
    
    def _select_best_quality(self, embeddings: List[np.ndarray],
                            qualities: List[float]) -> Tuple[np.ndarray, Dict]:
        """Select the embedding with highest quality"""
        try:
            best_idx = np.argmax(qualities)
            best_embedding = embeddings[best_idx]
            best_quality = qualities[best_idx]
            
            metadata = {
                'method': 'best_quality',
                'source_count': len(embeddings),
                'selected_index': int(best_idx),
                'selected_quality': float(best_quality),
                'quality_range': [float(min(qualities)), float(max(qualities))]
            }
            
            return best_embedding, metadata
        except Exception as e:
            logger.error(f"Error selecting best quality: {e}")
            return embeddings[0], {'method': 'fallback'}
    
    def _quality_filtered_centroid(self, embeddings: List[np.ndarray],
                                  qualities: List[float]) -> Tuple[np.ndarray, Dict]:
        """Create centroid from high-quality embeddings only"""
        try:
            quality_threshold = np.mean(qualities)
            filtered_embeddings = []
            filtered_qualities = []
            
            for emb, qual in zip(embeddings, qualities):
                if qual >= quality_threshold:
                    filtered_embeddings.append(emb)
                    filtered_qualities.append(qual)
            
            if not filtered_embeddings:
                filtered_embeddings = embeddings
                filtered_qualities = qualities
            
            weights = np.array(filtered_qualities) / np.sum(filtered_qualities)
            centroid = np.average(filtered_embeddings, axis=0, weights=weights)
            final_embedding = FaceEmbeddingProcessor.normalize_embedding(centroid)
            
            metadata = {
                'method': 'quality_filtered_centroid',
                'source_count': len(embeddings),
                'filtered_count': len(filtered_embeddings),
                'quality_threshold': float(quality_threshold),
                'average_filtered_quality': float(np.mean(filtered_qualities))
            }
            
            return final_embedding, metadata
        except Exception as e:
            logger.error(f"Error creating quality-filtered centroid: {e}")
            return embeddings[0], {'method': 'fallback'}
    
    def _save_separate_embeddings(self, student_id: str, embeddings: List[np.ndarray],
                                 qualities: List[float]) -> bool:
        """Save multiple embeddings separately for ensemble matching"""
        try:
            if not self.supabase_client:
                logger.error("Supabase client not configured")
                return False
            
            # Deactivate old embeddings
            self.supabase_client.get_client().table('student_face_embeddings').update({
                'is_active': False,
                'updated_at': datetime.now().isoformat()
            }).eq('student_id', student_id).execute()
            
            # Save each embedding
            from datetime import datetime
            for i, (embedding, quality) in enumerate(zip(embeddings, qualities)):
                embedding_data = {
                    'student_id': student_id,
                    'face_embedding_json': json.dumps(embedding.tolist()),
                    'face_quality': quality,
                    'enrollment_type': 'multiple_separate',
                    'embedding_index': i,
                    'total_embeddings': len(embeddings),
                    'system_version': '6.0.0-refactored',
                    'is_normalized': True,
                    'is_active': True,
                    'created_at': datetime.now().isoformat(),
                    'metadata_json': json.dumps({'method': 'separate_storage', 'index': i, 'total': len(embeddings)})
                }
                
                result = self.supabase_client.get_client().table('student_face_embeddings').insert(embedding_data).execute()
                if not result.data:
                    logger.error(f"Failed to save embedding {i} for {student_id}")
                    return False
            
            logger.info(f"✅ Saved {len(embeddings)} separate embeddings for {student_id}")
            return True
        except Exception as e:
            logger.error(f"Error saving separate embeddings: {e}")
            return False
    
    def _save_embedding_to_db(self, student_id: str, embedding: np.ndarray,
                             quality: float, metadata: Dict) -> bool:
        """Save single processed embedding to database"""
        try:
            if not self.supabase_client:
                logger.error("Supabase client not configured")
                return False
            
            from datetime import datetime
            embedding_data = {
                'student_id': student_id,
                'face_embedding_json': json.dumps(embedding.tolist()),
                'face_quality': quality,
                'enrollment_type': 'advanced_multiple',
                'system_version': '6.0.0-refactored',
                'is_normalized': True,
                'is_active': True,
                'created_at': datetime.now().isoformat(),
                'updated_at': datetime.now().isoformat(),
                'metadata_json': json.dumps(metadata)
            }
            
            # Deactivate old embeddings
            self.supabase_client.get_client().table('student_face_embeddings').update({
                'is_active': False,
                'updated_at': datetime.now().isoformat()
            }).eq('student_id', student_id).execute()
            
            # Insert new embedding
            result = self.supabase_client.get_client().table('student_face_embeddings').insert(embedding_data).execute()
            
            if result.data:
                if self.cache_manager:
                    self.cache_manager.set_embedding_cache(student_id, embedding)
                
                logger.info(f"✅ Advanced embedding saved for {student_id} (method: {metadata.get('method')})")
                return True
            return False
        except Exception as e:
            logger.error(f"Error saving embedding to database: {e}")
            return False
    
    def get_embedding_advanced(self, student_id: str) -> Optional[np.ndarray]:
        """Get face embedding with caching and ensemble support"""
        try:
            # Check cache
            if self.cache_manager:
                cached = self.cache_manager.get_embedding_cache(student_id)
                if cached is not None:
                    return cached
            
            if not self.supabase_client:
                return None
            
            # Get from database
            result = self.supabase_client.get_client().table('student_face_embeddings').select('*')\
                .eq('student_id', student_id)\
                .eq('is_active', True)\
                .execute()
            
            if not result.data:
                return None
            
            # Handle multiple embeddings
            if len(result.data) > 1:
                return self._process_ensemble_embeddings(student_id, result.data)
            else:
                embedding_data = result.data[0]
                embedding_json = json.loads(embedding_data['face_embedding_json'])
                embedding = np.array(embedding_json, dtype=np.float64)
                
                if not embedding_data.get('is_normalized', False):
                    embedding = FaceEmbeddingProcessor.normalize_embedding(embedding)
                
                if self.cache_manager:
                    self.cache_manager.set_embedding_cache(student_id, embedding)
                
                return embedding
        except Exception as e:
            logger.error(f"Error getting advanced embedding for {student_id}: {e}")
            return None
    
    def _process_ensemble_embeddings(self, student_id: str, embedding_records: List[Dict]) -> Optional[np.ndarray]:
        """Process multiple embeddings using ensemble method"""
        try:
            embeddings = []
            qualities = []
            
            for record in embedding_records:
                try:
                    embedding_json = json.loads(record['face_embedding_json'])
                    embedding = np.array(embedding_json, dtype=np.float64)
                    
                    if not record.get('is_normalized', False):
                        embedding = FaceEmbeddingProcessor.normalize_embedding(embedding)
                    
                    embeddings.append(embedding)
                    qualities.append(record.get('face_quality', 0.5))
                except Exception as e:
                    logger.warning(f"Error processing embedding for {student_id}: {e}")
                    continue
            
            if not embeddings:
                return None
            
            weights = np.array(qualities) / np.sum(qualities)
            ensemble_embedding = np.average(embeddings, axis=0, weights=weights)
            final_embedding = FaceEmbeddingProcessor.normalize_embedding(ensemble_embedding)
            
            if self.cache_manager:
                self.cache_manager.set_embedding_cache(student_id, final_embedding)
            
            logger.info(f"✅ Created ensemble embedding for {student_id} from {len(embeddings)} sources")
            return final_embedding
        except Exception as e:
            logger.error(f"Error processing ensemble embeddings: {e}")
            return None


def process_faces_with_advanced_matching(image_array: np.ndarray, enrolled_students: List[str],
                                        config: Dict, motion_strength: float = 0.5,
                                        embedding_manager=None, use_advanced_similarity: bool = True) -> List[Dict]:
    """Face processing with advanced similarity calculation"""
    try:
        start_time = time.time()
        
        if image_array is None or image_array.size == 0:
            logger.warning("Empty image array")
            return []
        
        if not enrolled_students:
            logger.warning("⚠️ No students → running detection-only mode")
            
            
        logger.info(f"🔍 Advanced processing with {len(enrolled_students)} enrolled students")
        
        # Detect faces
        face_locations = FaceEmbeddingProcessor.detect_faces_in_image(image_array, model="hog")
        
        if not face_locations:
            logger.info("❌ No faces detected")
            return []
        
        # Extract encodings
        face_encodings = FaceEmbeddingProcessor.extract_face_encodings(image_array, face_locations, num_jitters=2)
        
        if not face_encodings:
            logger.warning("❌ No face encodings generated")
            return []
        
        detected_faces = []
        base_threshold = config.get('face_threshold', 0.6)
        
        for i, (encoding, location) in enumerate(zip(face_encodings, face_locations)):
            logger.info(f"🔍 Processing face {i+1}/{len(face_encodings)}")
            
            norm_encoding = FaceEmbeddingProcessor.normalize_embedding(encoding)
            if norm_encoding is None:
                continue
            
            # Advanced similarity analysis
            similarity_results = []
            
            for student_id in enrolled_students:
                if not embedding_manager:
                    continue
                
                stored_embedding = embedding_manager.get_embedding_advanced(student_id)
                if stored_embedding is None:
                    continue
                
                if use_advanced_similarity:
                    similarity_metrics = SimilarityCalculator.calculate_advanced_similarity(norm_encoding, stored_embedding)
                else:
                    simple_score = SimilarityCalculator.calculate_simple_similarity(norm_encoding, stored_embedding)
                    similarity_metrics = {'combined_score': simple_score, 'confidence_level': 'medium'}
                
                similarity_results.append({
                    'student_id': student_id,
                    'similarity_score': similarity_metrics['combined_score'],
                    'confidence_level': similarity_metrics.get('confidence_level', 'medium'),
                    'detailed_metrics': similarity_metrics
                })
            
            # Sort by similarity
            similarity_results.sort(key=lambda x: x['similarity_score'], reverse=True)
            
            # Determine best match
            best_match = None
            best_score = 0.0
            confidence_level = 'very_low'
            threshold = base_threshold
            
            if similarity_results:
                top_result = similarity_results[0]
                
                # Adaptive threshold
                if top_result['confidence_level'] == 'very_high':
                    threshold = base_threshold * 0.7
                elif top_result['confidence_level'] == 'high':
                    threshold = base_threshold * 0.8
                
                if top_result['similarity_score'] > threshold:
                    best_match = top_result['student_id']
                    best_score = top_result['similarity_score']
                    confidence_level = top_result['confidence_level']
                    logger.info(f"✅ Face {i+1} recognized as {best_match}")
            
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
                'processing_method': 'advanced_similarity',
                'motion_strength': motion_strength,
                'processing_time': time.time() - start_time
            }
            
            detected_faces.append(face_info)
        
        processing_time = time.time() - start_time
        verified_count = len([f for f in detected_faces if f['verified']])
        
        logger.info(f"📋 Advanced processing complete: {verified_count} recognized in {processing_time:.2f}s")
        
        return detected_faces
        
    except Exception as e:
        logger.error(f"Error in advanced face processing: {e}")
        return []
