import requests
import os

url = "http://localhost:8000/api/face/enroll-advanced" # Updated port to match server

# Create dummy images for testing
image_path = "test_face.jpg"
if not os.path.exists(image_path):
    import cv2
    import numpy as np
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    cv2.imwrite(image_path, img)

files = [
    ('images', open(image_path, 'rb')),
]

data = {
    'student_id': '65021111',
    'student_email': 'test@example.com',
    'enrollment_method': 'all_separate',
    'min_quality_threshold': 0.0 # Set to 0 to bypass quality check for dummy image
}

try:
    response = requests.post(url, files=files, data=data)
    print(f"Status Code: {response.status_code}")
    print(f"Response Body: {response.text}")
except Exception as e:
    print(f"Request failed: {e}")
finally:
    for _, f in files:
        f.close()
