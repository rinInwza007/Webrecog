# Motion Detection Session Lifecycle Test
import requests
import json
import time
from datetime import datetime, timedelta
from PIL import Image, ImageDraw, ImageFont
import numpy as np
import io
import random
import os

# Configuration
API_BASE_URL = "http://localhost:8000"
TEST_TEACHER_EMAIL = "teacher@test.com"
TEST_CLASS_ID = "CS101"
TEST_STUDENT_IDS = ["STU001", "STU002", "STU003"]
TEST_STUDENT_EMAILS = ["student1@test.com", "student2@test.com", "student3@test.com"]

class SessionLifecycleTest:
    def __init__(self, base_url=API_BASE_URL):
        self.base_url = base_url
        self.session = requests.Session()
        self.current_session_id = None
        self.session_stats = {}
        self.motion_events = []
        self.attendance_records = []
        
    def print_banner(self, text, char="="):
        """Print formatted banner"""
        print(f"\n{char * 60}")
        print(f" {text}")
        print(f"{char * 60}")
    
    def print_section(self, text):
        """Print section header"""
        print(f"\n{'>' * 3} {text}")
        print("-" * 40)
    
    def create_realistic_face_image(self, person_id=1, width=640, height=480):
        """Create a more realistic test image with face-like features"""
        # Base colors for different people
        skin_colors = [
            (220, 190, 160),  # Light skin
            (210, 180, 140),  # Medium skin  
            (180, 140, 100),  # Darker skin
        ]
        
        base_color = skin_colors[person_id % len(skin_colors)]
        
        # Create base image
        image = Image.new('RGB', (width, height), (50, 100, 150))  # Background
        draw = ImageDraw.Draw(image)
        
        # Draw face area (oval)
        face_x = width // 3
        face_y = height // 4
        face_w = width // 3
        face_h = height // 2
        
        # Add some randomness
        face_x += random.randint(-20, 20)
        face_y += random.randint(-10, 10)
        
        draw.ellipse([face_x, face_y, face_x + face_w, face_y + face_h], 
                    fill=base_color, outline=(100, 100, 100))
        
        # Draw eyes
        eye_y = face_y + face_h // 3
        left_eye_x = face_x + face_w // 4
        right_eye_x = face_x + 3 * face_w // 4
        eye_size = 15
        
        draw.ellipse([left_eye_x - eye_size//2, eye_y - eye_size//2,
                     left_eye_x + eye_size//2, eye_y + eye_size//2], 
                    fill=(255, 255, 255))
        draw.ellipse([right_eye_x - eye_size//2, eye_y - eye_size//2,
                     right_eye_x + eye_size//2, eye_y + eye_size//2], 
                    fill=(255, 255, 255))
        
        # Draw pupils
        pupil_size = 8
        draw.ellipse([left_eye_x - pupil_size//2, eye_y - pupil_size//2,
                     left_eye_x + pupil_size//2, eye_y + pupil_size//2], 
                    fill=(0, 0, 0))
        draw.ellipse([right_eye_x - pupil_size//2, eye_y - pupil_size//2,
                     right_eye_x + pupil_size//2, eye_y + pupil_size//2], 
                    fill=(0, 0, 0))
        
        # Draw nose
        nose_x = face_x + face_w // 2
        nose_y = face_y + face_h // 2
        draw.ellipse([nose_x - 8, nose_y - 5, nose_x + 8, nose_y + 10], 
                    fill=tuple(max(0, c - 20) for c in base_color))
        
        # Draw mouth
        mouth_y = face_y + 2 * face_h // 3
        draw.ellipse([nose_x - 20, mouth_y - 5, nose_x + 20, mouth_y + 5], 
                    fill=(150, 50, 50))
        
        # Add some noise for realism
        pixels = np.array(image)
        noise = np.random.randint(-10, 10, pixels.shape)
        pixels = np.clip(pixels + noise, 0, 255)
        
        return Image.fromarray(pixels.astype('uint8'))
    
    def image_to_bytes(self, image):
        """Convert PIL image to bytes"""
        img_byte_arr = io.BytesIO()
        image.save(img_byte_arr, format='JPEG', quality=85)
        return img_byte_arr.getvalue()
    
    def setup_test_students(self):
        """Setup test students with face enrollment"""
        self.print_section("Setting up test students with face enrollment")
        
        for i, (student_id, student_email) in enumerate(zip(TEST_STUDENT_IDS, TEST_STUDENT_EMAILS)):
            print(f"📝 Enrolling student {i+1}: {student_id}")
            
            # Create multiple face images for this student
            images = []
            for angle in range(3):  # 3 different angles
                face_image = self.create_realistic_face_image(person_id=i, width=640, height=480)
                # Slightly modify each image
                if angle == 1:
                    face_image = face_image.rotate(2)  # Slight rotation
                elif angle == 2:
                    # Slight brightness change
                    pixels = np.array(face_image)
                    pixels = np.clip(pixels + 10, 0, 255)
                    face_image = Image.fromarray(pixels.astype('uint8'))
                
                images.append(self.image_to_bytes(face_image))
            
            # Enroll face
            try:
                files = []
                for j, img_bytes in enumerate(images):
                    files.append(('images', (f'{student_id}_face_{j}.jpg', img_bytes, 'image/jpeg')))
                
                data = {
                    'student_id': student_id,
                    'student_email': student_email
                }
                
                response = self.session.post(
                    f"{self.base_url}/api/face/enroll",
                    files=files,
                    data=data
                )
                response.raise_for_status()
                result = response.json()
                
                if result.get("success"):
                    print(f"   ✅ Enrolled with quality: {result.get('quality_score', 0):.3f}")
                else:
                    print(f"   ❌ Enrollment failed: {result}")
                    
            except Exception as e:
                print(f"   ❌ Enrollment error: {e}")
        
        print(f"\n👥 Total students enrolled: {len(TEST_STUDENT_IDS)}")
    
    def start_motion_session(self, duration_hours=2, motion_threshold=0.1):
        """Start motion detection session with detailed logging"""
        self.print_section("Starting Motion Detection Session")
        
        try:
            # Create initial classroom image with multiple students
            initial_image = self.create_classroom_scene(num_students=2)
            img_bytes = self.image_to_bytes(initial_image)
            
            # Session configuration
            session_config = {
                'class_id': TEST_CLASS_ID,
                'teacher_email': TEST_TEACHER_EMAIL,
                'duration_hours': duration_hours,
                'motion_threshold': motion_threshold,
                'cooldown_seconds': 30,
                'on_time_limit_minutes': 30
            }
            
            print("📋 Session Configuration:")
            for key, value in session_config.items():
                print(f"   {key}: {value}")
            
            files = [('initial_image', ('classroom_initial.jpg', img_bytes, 'image/jpeg'))]
            
            print(f"\n🚀 Creating session...")
            response = self.session.post(
                f"{self.base_url}/api/session/start-motion-detection",
                files=files,
                data=session_config
            )
            response.raise_for_status()
            result = response.json()
            
            if result.get("success"):
                self.current_session_id = result.get("session_id")
                
                print(f"✅ Session created successfully!")
                print(f"   📄 Session ID: {self.current_session_id}")
                print(f"   🕐 Start Time: {result.get('start_time')}")
                print(f"   🕕 End Time: {result.get('end_time')}")
                print(f"   🎯 Motion Threshold: {result.get('motion_threshold')}")
                print(f"   ⏱️  Cooldown: {session_config['cooldown_seconds']}s")
                print(f"   📊 Queue Size: {result.get('processing_queue_size', 0)}")
                
                self.session_stats['start_time'] = datetime.now()
                self.session_stats['config'] = session_config
                self.session_stats['session_id'] = self.current_session_id
                
                return True
            else:
                print(f"❌ Session creation failed: {result}")
                return False
                
        except Exception as e:
            print(f"❌ Error starting session: {e}")
            return False
    
    def create_classroom_scene(self, num_students=3):
        """Create classroom scene with multiple students"""
        classroom = Image.new('RGB', (1024, 768), (240, 240, 220))  # Classroom background
        
        # Add students at different positions
        positions = [(150, 200), (400, 180), (650, 220), (300, 400), (550, 380)]
        
        for i in range(min(num_students, len(positions))):
            student_face = self.create_realistic_face_image(person_id=i, width=120, height=160)
            x, y = positions[i]
            classroom.paste(student_face, (x, y))
        
        return classroom
    
    def simulate_session_activity(self, duration_minutes=5):
        """Simulate realistic session activity with motion events"""
        self.print_section(f"Simulating {duration_minutes} minutes of session activity")
        
        if not self.current_session_id:
            print("❌ No active session to simulate")
            return
        
        start_time = time.time()
        motion_event_count = 0
        successful_snapshots = 0
        blocked_snapshots = 0
        
        # Simulate different scenarios
        scenarios = [
            {"name": "Students entering class", "motion_strength": 0.6, "students": 3},
            {"name": "Late student arriving", "motion_strength": 0.4, "students": 1},
            {"name": "Student moving around", "motion_strength": 0.3, "students": 1},
            {"name": "Group discussion", "motion_strength": 0.5, "students": 2},
            {"name": "Teacher walking", "motion_strength": 0.2, "students": 0}
        ]
        
        for minute in range(duration_minutes):
            elapsed_minutes = minute
            scenario = scenarios[minute % len(scenarios)]
            
            print(f"\n📅 Minute {minute + 1}: {scenario['name']}")
            
            # Create scenario-specific image
            scene_image = self.create_classroom_scene(num_students=scenario['students'])
            
            # Add motion effect based on strength
            if scenario['motion_strength'] > 0.1:
                scene_image = self.add_motion_blur(scene_image, scenario['motion_strength'])
            
            motion_event_count += 1
            
            # Send motion snapshot
            snapshot_result = self.send_motion_snapshot(
                image=scene_image,
                motion_strength=scenario['motion_strength'],
                elapsed_minutes=elapsed_minutes,
                scenario_name=scenario['name']
            )
            
            if snapshot_result:
                if snapshot_result.get('success'):
                    successful_snapshots += 1
                    print(f"   ✅ Snapshot processed (Priority: {snapshot_result.get('processing_priority')})")
                else:
                    blocked_snapshots += 1
                    print(f"   🚫 Snapshot blocked: {snapshot_result.get('block_reason', 'Unknown')}")
            
            # Show live stats every 2 minutes
            if (minute + 1) % 2 == 0:
                self.show_live_stats()
            
            # Wait for cooldown (reduced for simulation)
            time.sleep(15)  # 15 seconds instead of 30 for faster testing
        
        total_time = time.time() - start_time
        
        print(f"\n📊 Session Activity Summary:")
        print(f"   ⏱️  Total Time: {total_time:.1f} seconds")
        print(f"   🎯 Motion Events: {motion_event_count}")
        print(f"   ✅ Successful Snapshots: {successful_snapshots}")
        print(f"   🚫 Blocked Snapshots: {blocked_snapshots}")
        print(f"   📈 Success Rate: {successful_snapshots/motion_event_count*100:.1f}%")
    
    def add_motion_blur(self, image, motion_strength):
        """Add motion blur effect to simulate movement"""
        pixels = np.array(image)
        
        # Add motion blur based on strength
        blur_amount = int(motion_strength * 5)
        if blur_amount > 0:
            # Simple horizontal blur simulation
            for y in range(pixels.shape[0]):
                for x in range(blur_amount, pixels.shape[1] - blur_amount):
                    pixels[y, x] = np.mean(pixels[y, x-blur_amount:x+blur_amount+1], axis=0)
        
        return Image.fromarray(pixels.astype('uint8'))
    
    def send_motion_snapshot(self, image, motion_strength, elapsed_minutes, scenario_name=""):
        """Send motion-triggered snapshot"""
        try:
            img_bytes = self.image_to_bytes(image)
            
            data = {
                'session_id': self.current_session_id,
                'motion_strength': motion_strength,
                'elapsed_minutes': elapsed_minutes,
                'device_id': 'test_classroom_camera_001'
            }
            
            files = [('image', (f'motion_{elapsed_minutes}_{scenario_name.replace(" ", "_")}.jpg', 
                              img_bytes, 'image/jpeg'))]
            
            response = self.session.post(
                f"{self.base_url}/api/motion/snapshot",
                files=files,
                data=data
            )
            response.raise_for_status()
            result = response.json()
            
            # Log motion event
            self.motion_events.append({
                'timestamp': datetime.now().isoformat(),
                'scenario': scenario_name,
                'motion_strength': motion_strength,
                'elapsed_minutes': elapsed_minutes,
                'result': result
            })
            
            return result
            
        except Exception as e:
            print(f"   ❌ Motion snapshot error: {e}")
            return None
    
    def show_live_stats(self):
        """Show current session statistics"""
        if not self.current_session_id:
            return
        
        try:
            response = self.session.get(
                f"{self.base_url}/api/motion/session/{self.current_session_id}/live-stats"
            )
            response.raise_for_status()
            result = response.json()
            
            if result.get("success"):
                live_stats = result.get("live_stats", {})
                recent_activity = result.get("recent_activity", {})
                
                print(f"\n📊 Live Session Statistics:")
                print(f"   🎯 Motion Events: {live_stats.get('motion_events', 0)}")
                print(f"   📸 Snapshots Taken: {live_stats.get('snapshots_taken', 0)}")
                print(f"   📈 Snapshot Efficiency: {live_stats.get('snapshot_efficiency', 0):.3f}")
                print(f"   🕒 Last Snapshot: {live_stats.get('last_snapshot', 'Never')}")
                
                print(f"\n📈 Recent Activity (Last Hour):")
                print(f"   📷 Total Captures: {recent_activity.get('total_captures_last_hour', 0)}")
                print(f"   ✅ Successful: {recent_activity.get('successful_captures', 0)}")
                print(f"   📊 Success Rate: {recent_activity.get('success_rate', 0):.3f}")
                
                # Motion strength distribution
                distribution = recent_activity.get('motion_strength_distribution', {})
                print(f"   🎯 Motion Distribution:")
                print(f"      Weak: {distribution.get('weak', 0)}")
                print(f"      Moderate: {distribution.get('moderate', 0)}")
                print(f"      Strong: {distribution.get('strong', 0)}")
                
        except Exception as e:
            print(f"❌ Error getting live stats: {e}")
    
    def test_manual_teacher_capture(self):
        """Test manual teacher capture during session"""
        self.print_section("Testing Manual Teacher Capture")
        
        if not self.current_session_id:
            print("❌ No active session for manual capture")
            return
        
        try:
            # Create a high-quality classroom image
            teacher_image = self.create_classroom_scene(num_students=4)
            img_bytes = self.image_to_bytes(teacher_image)
            
            data = {
                'session_id': self.current_session_id,
                'force_capture': False
            }
            
            files = [('image', ('teacher_manual_capture.jpg', img_bytes, 'image/jpeg'))]
            
            print("📸 Sending manual teacher capture...")
            response = self.session.post(
                f"{self.base_url}/api/motion/manual-capture",
                files=files,
                data=data
            )
            response.raise_for_status()
            result = response.json()
            
            if result.get("success"):
                print(f"✅ Manual capture successful!")
                print(f"   👥 Faces Detected: {result.get('faces_detected', 0)}")
                print(f"   🔢 Processing Priority: {result.get('processing_priority', 'N/A')}")
                print(f"   📊 Queue Size: {result.get('queue_size', 0)}")
            else:
                print(f"❌ Manual capture failed: {result.get('message', 'Unknown error')}")
                
                # Try force capture if blocked
                print("🔄 Trying force capture...")
                data['force_capture'] = True
                
                response = self.session.post(
                    f"{self.base_url}/api/motion/manual-capture",
                    files=files,
                    data=data
                )
                response.raise_for_status()
                force_result = response.json()
                
                if force_result.get("success"):
                    print(f"✅ Force capture successful!")
                else:
                    print(f"❌ Force capture also failed: {force_result}")
                    
        except Exception as e:
            print(f"❌ Manual capture error: {e}")
    
    def get_final_session_statistics(self):
        """Get comprehensive session statistics"""
        self.print_section("Generating Final Session Statistics")
        
        if not self.current_session_id:
            print("❌ No session to analyze")
            return None
        
        try:
            response = self.session.get(
                f"{self.base_url}/api/session/{self.current_session_id}/motion-statistics"
            )
            response.raise_for_status()
            result = response.json()
            
            if result.get("success"):
                session_info = result.get("session_info", {})
                attendance_stats = result.get("attendance_statistics", {})
                motion_stats = result.get("motion_statistics", {})
                capture_breakdown = result.get("capture_breakdown", {})
                phase_breakdown = result.get("phase_breakdown", {})
                
                self.print_banner("📊 FINAL SESSION STATISTICS", "=")
                
                # Session Information
                print(f"🆔 Session ID: {session_info.get('session_id', 'N/A')}")
                print(f"🏫 Class ID: {session_info.get('class_id', 'N/A')}")
                print(f"👨‍🏫 Teacher: {session_info.get('teacher_email', 'N/A')}")
                print(f"🕐 Start Time: {session_info.get('start_time', 'N/A')}")
                print(f"🕕 End Time: {session_info.get('end_time', 'N/A')}")
                print(f"⏱️ Duration: {session_info.get('duration_hours', 'N/A')} hours")
                
                # Attendance Statistics
                print(f"\n👥 ATTENDANCE STATISTICS:")
                print(f"   Total Students: {attendance_stats.get('total_students', 0)}")
                print(f"   Present: {attendance_stats.get('present_count', 0)}")
                print(f"   Late: {attendance_stats.get('late_count', 0)}")
                print(f"   Absent: {attendance_stats.get('absent_count', 0)}")
                print(f"   Attendance Rate: {attendance_stats.get('attendance_rate', 0):.1%}")
                
                # Motion Detection Statistics
                print(f"\n🎯 MOTION DETECTION STATISTICS:")
                print(f"   Total Motion Events: {motion_stats.get('total_motion_events', 0)}")
                print(f"   Snapshots Taken: {motion_stats.get('snapshots_taken', 0)}")
                print(f"   Snapshot Efficiency: {motion_stats.get('snapshot_efficiency', 0):.1%}")
                print(f"   Average Motion Strength: {motion_stats.get('average_motion_strength', 0):.3f}")
                print(f"   Motion Threshold Used: {motion_stats.get('motion_threshold', 0):.3f}")
                print(f"   Cooldown Setting: {motion_stats.get('cooldown_seconds', 0)}s")
                
                # Capture Breakdown
                print(f"\n📸 CAPTURE BREAKDOWN:")
                by_type = capture_breakdown.get('by_type', {})
                by_trigger = capture_breakdown.get('by_trigger', {})
                
                print(f"   By Type:")
                for capture_type, count in by_type.items():
                    print(f"      {capture_type}: {count}")
                
                print(f"   By Trigger:")
                for trigger_type, count in by_trigger.items():
                    print(f"      {trigger_type}: {count}")
                
                # Phase Breakdown
                print(f"\n⏰ PROCESSING PHASE BREAKDOWN:")
                for phase, stats in phase_breakdown.items():
                    print(f"   Phase {phase}:")
                    print(f"      Captures: {stats.get('count', 0)}")
                    print(f"      Faces Detected: {stats.get('faces_detected', 0)}")
                    print(f"      Faces Recognized: {stats.get('faces_recognized', 0)}")
                    if stats.get('faces_detected', 0) > 0:
                        recognition_rate = stats.get('faces_recognized', 0) / stats.get('faces_detected', 1)
                        print(f"      Recognition Rate: {recognition_rate:.1%}")
                
                # Processing Queue
                queue_size = result.get('processing_queue_size', 0)
                print(f"\n🔄 PROCESSING STATUS:")
                print(f"   Current Queue Size: {queue_size}")
                
                # Hourly Motion Events
                hourly_events = result.get('hourly_motion_events', {})
                if hourly_events:
                    print(f"\n📅 HOURLY MOTION ACTIVITY:")
                    for hour, count in sorted(hourly_events.items()):
                        print(f"   {hour}: {count} events")
                
                return result
                
        except Exception as e:
            print(f"❌ Error getting final statistics: {e}")
            return None
    
    def end_motion_session(self):
        """End motion detection session with detailed final report"""
        self.print_section("Ending Motion Detection Session")
        
        if not self.current_session_id:
            print("❌ No active session to end")
            return False
        
        try:
            print(f"🔚 Ending session: {self.current_session_id}")
            
            response = self.session.put(
                f"{self.base_url}/api/session/{self.current_session_id}/end-motion"
            )
            response.raise_for_status()
            result = response.json()
            
            if result.get("success"):
                print(f"✅ Session ended successfully!")
                
                # Show final statistics from the end response
                final_stats = result.get("final_statistics", {})
                if final_stats:
                    print(f"\n📋 Quick Final Summary:")
                    attendance_stats = final_stats.get("attendance_statistics", {})
                    motion_stats = final_stats.get("motion_statistics", {})
                    
                    print(f"   👥 Total Students: {attendance_stats.get('total_students', 0)}")
                    print(f"   ✅ Attended: {attendance_stats.get('present_count', 0) + attendance_stats.get('late_count', 0)}")
                    print(f"   📈 Attendance Rate: {attendance_stats.get('attendance_rate', 0):.1%}")
                    print(f"   🎯 Motion Events: {motion_stats.get('total_motion_events', 0)}")
                    print(f"   📸 Snapshots: {motion_stats.get('snapshots_taken', 0)}")
                
                # Record end time
                self.session_stats['end_time'] = datetime.now()
                self.session_stats['duration'] = self.session_stats['end_time'] - self.session_stats['start_time']
                
                # Clear current session
                self.current_session_id = None
                
                return True
            else:
                print(f"❌ Failed to end session: {result}")
                return False
                
        except Exception as e:
            print(f"❌ Error ending session: {e}")
            return False
    
    def generate_session_report(self):
        """Generate comprehensive session report"""
        self.print_banner("📄 SESSION LIFECYCLE REPORT", "=")
        
        if not self.session_stats:
            print("❌ No session data to report")
            return
        
        # Session Overview
        print(f"🆔 Session ID: {self.session_stats.get('session_id', 'N/A')}")
        print(f"🕐 Start Time: {self.session_stats.get('start_time', 'N/A')}")
        print(f"🕕 End Time: {self.session_stats.get('end_time', 'N/A')}")
        if 'duration' in self.session_stats:
            duration = self.session_stats['duration']
            print(f"⏱️ Total Duration: {duration}")
        
        # Configuration Used
        config = self.session_stats.get('config', {})
        print(f"\n⚙️ Configuration:")
        for key, value in config.items():
            print(f"   {key}: {value}")
        
        # Motion Events Summary
        print(f"\n🎯 Motion Events Summary:")
        print(f"   Total Events Logged: {len(self.motion_events)}")
        
        if self.motion_events:
            # Analyze motion events
            motion_strengths = [event['motion_strength'] for event in self.motion_events]
            avg_strength = sum(motion_strengths) / len(motion_strengths)
            max_strength = max(motion_strengths)
            min_strength = min(motion_strengths)
            
            print(f"   Average Motion Strength: {avg_strength:.3f}")
            print(f"   Max Motion Strength: {max_strength:.3f}")
            print(f"   Min Motion Strength: {min_strength:.3f}")
            
            # Success rate analysis
            successful_events = [e for e in self.motion_events if e['result'] and e['result'].get('success')]
            success_rate = len(successful_events) / len(self.motion_events) * 100
            print(f"   Success Rate: {success_rate:.1f}%")
            
            # Scenario breakdown
            scenarios = {}
            for event in self.motion_events:
                scenario = event.get('scenario', 'Unknown')
                scenarios[scenario] = scenarios.get(scenario, 0) + 1
            
            print(f"\n📊 Scenario Breakdown:")
            for scenario, count in scenarios.items():
                print(f"   {scenario}: {count}")
        
        # Save report to file
        report_filename = f"session_report_{self.session_stats.get('session_id', 'unknown')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        full_report = {
            'session_stats': {
                **self.session_stats,
                'start_time': self.session_stats.get('start_time', datetime.now()).isoformat(),
                'end_time': self.session_stats.get('end_time', datetime.now()).isoformat(),
                'duration': str(self.session_stats.get('duration', timedelta(0)))
            },
            'motion_events': self.motion_events,
            'test_metadata': {
                'api_base_url': self.base_url,
                'test_students': TEST_STUDENT_IDS,
                'test_class': TEST_CLASS_ID,
                'report_generated': datetime.now().isoformat()
            }
        }
        
        try:
            with open(report_filename, 'w') as f:
                json.dump(full_report, f, indent=2, default=str)
            print(f"\n💾 Full report saved to: {report_filename}")
        except Exception as e:
            print(f"❌ Error saving report: {e}")
    
    def run_complete_session_lifecycle(self, simulation_minutes=5):
        """Run complete session lifecycle test"""
        self.print_banner("🎬 MOTION DETECTION SESSION LIFECYCLE TEST", "=")
        
        print(f"📋 Test Configuration:")
        print(f"   🏫 Class ID: {TEST_CLASS_ID}")
        print(f"   👨‍🏫 Teacher: {TEST_TEACHER_EMAIL}")
        print(f"   👥 Students: {len(TEST_STUDENT_IDS)}")
        print(f"   ⏱️ Simulation Duration: {simulation_minutes} minutes")
        print(f"   🌐 API Base URL: {self.base_url}")
        
        try:
            # Phase 1: Setup
            print(f"\n🔄 Phase 1: Environment Setup")
            self.setup_test_students()
            
            # Phase 2: Start Session
            print(f"\n🔄 Phase 2: Session Creation")
            if not self.start_motion_session(duration_hours=2, motion_threshold=0.1):
                print("❌ Session creation failed, aborting test")
                return False
            
            # Phase 3: Session Activity
            print(f"\n🔄 Phase 3: Session Activity Simulation")
            self.simulate_session_activity(duration_minutes=simulation_minutes)
            
            # Phase 4: Manual Teacher Interaction
            print(f"\n🔄 Phase 4: Manual Teacher Interaction")
            self.test_manual_teacher_capture()
            
            # Phase 5: Final Statistics
            print(f"\n🔄 Phase 5: Session Analysis")
            self.get_final_session_statistics()
            
            # Phase 6: Session End
            print(f"\n🔄 Phase 6: Session Termination")
            if not self.end_motion_session():
                print("⚠️ Session end failed, but continuing with report")
            
            # Phase 7: Report Generation
            print(f"\n🔄 Phase 7: Report Generation")
            self.generate_session_report()
            
            self.print_banner("✅ SESSION LIFECYCLE TEST COMPLETED", "=")
            return True
            
        except Exception as e:
            print(f"❌ Critical error in session lifecycle: {e}")
            
            # Attempt to end session if it exists
            if self.current_session_id:
                print("🔄 Attempting emergency session cleanup...")
                self.end_motion_session()
            
            return False

# ==================== Quick Test Functions ====================

def quick_session_test():
    """Quick session test - start and end immediately"""
    print("🚀 Quick Session Test")
    print("-" * 30)
    
    tester = SessionLifecycleTest()
    
    try:
        # Start session
        if tester.start_motion_session(duration_hours=1, motion_threshold=0.15):
            print("✅ Session started successfully")
            
            # Wait a moment
            time.sleep(2)
            
            # Get quick stats
            tester.show_live_stats()
            
            # End session
            if tester.end_motion_session():
                print("✅ Session ended successfully")
                return True
        
        return False
        
    except Exception as e:
        print(f"❌ Quick test failed: {e}")
        return False

def demo_session_with_activity():
    """Demo session with some activity"""
    print("🎭 Demo Session with Activity")
    print("-" * 40)
    
    tester = SessionLifecycleTest()
    
    try:
        # Setup minimal students
        print("📝 Setting up demo students...")
        tester.setup_test_students()
        
        # Start session
        if tester.start_motion_session(duration_hours=1, motion_threshold=0.12):
            print("✅ Demo session started")
            
            # Simulate short activity
            print("🎬 Simulating classroom activity...")
            tester.simulate_session_activity(duration_minutes=3)
            
            # Manual capture
            print("📸 Testing manual capture...")
            tester.test_manual_teacher_capture()
            
            # Final stats
            print("📊 Getting session statistics...")
            tester.get_final_session_statistics()
            
            # End session
            tester.end_motion_session()
            
            print("✅ Demo completed successfully")
            return True
        
        return False
        
    except Exception as e:
        print(f"❌ Demo failed: {e}")
        return False

def test_session_statistics_only():
    """Test session statistics without creating new session"""
    print("📊 Session Statistics Test")
    print("-" * 30)
    
    # This assumes there's an active session
    session_id = input("Enter session ID (or press Enter to skip): ").strip()
    
    if not session_id:
        print("⏭️ Skipping statistics test")
        return False
    
    tester = SessionLifecycleTest()
    tester.current_session_id = session_id
    
    try:
        print(f"📋 Testing statistics for session: {session_id}")
        
        # Live stats
        tester.show_live_stats()
        
        # Full stats
        tester.get_final_session_statistics()
        
        return True
        
    except Exception as e:
        print(f"❌ Statistics test failed: {e}")
        return False

def stress_test_motion_events():
    """Stress test with many motion events"""
    print("🔥 Motion Events Stress Test")
    print("-" * 35)
    
    tester = SessionLifecycleTest()
    
    try:
        # Start session
        if not tester.start_motion_session(duration_hours=1, motion_threshold=0.1):
            return False
        
        print("🔥 Sending rapid motion events...")
        
        # Send many motion events rapidly
        successful = 0
        blocked = 0
        
        for i in range(20):
            # Create different scenarios
            motion_strength = 0.1 + (i % 5) * 0.15  # Vary strength
            students = (i % 3) + 1  # Vary number of students
            
            scene = tester.create_classroom_scene(num_students=students)
            if motion_strength > 0.3:
                scene = tester.add_motion_blur(scene, motion_strength)
            
            result = tester.send_motion_snapshot(
                image=scene,
                motion_strength=motion_strength,
                elapsed_minutes=i,
                scenario_name=f"stress_test_{i}"
            )
            
            if result and result.get('success'):
                successful += 1
                print(f"   ✅ Event {i+1}: Success")
            else:
                blocked += 1
                print(f"   🚫 Event {i+1}: Blocked")
            
            # Small delay
            time.sleep(1)
        
        print(f"\n📊 Stress Test Results:")
        print(f"   ✅ Successful: {successful}")
        print(f"   🚫 Blocked: {blocked}")
        print(f"   📈 Success Rate: {successful/(successful+blocked)*100:.1f}%")
        
        # Final stats
        tester.get_final_session_statistics()
        
        # End session
        tester.end_motion_session()
        
        return True
        
    except Exception as e:
        print(f"❌ Stress test failed: {e}")
        return False

def interactive_session_test():
    """Interactive session test with user prompts"""
    print("🎮 Interactive Session Test")
    print("-" * 30)
    
    tester = SessionLifecycleTest()
    
    # Configuration
    print("⚙️ Session Configuration:")
    duration = input("Duration (hours, default 2): ").strip() or "2"
    threshold = input("Motion threshold (0.0-1.0, default 0.1): ").strip() or "0.1"
    sim_minutes = input("Simulation minutes (default 3): ").strip() or "3"
    
    try:
        duration = int(duration)
        threshold = float(threshold)
        sim_minutes = int(sim_minutes)
    except ValueError:
        print("❌ Invalid input, using defaults")
        duration, threshold, sim_minutes = 2, 0.1, 3
    
    print(f"📋 Using: {duration}h duration, {threshold} threshold, {sim_minutes}min simulation")
    
    try:
        # Setup
        setup = input("\nSetup test students? (y/n, default y): ").strip().lower()
        if setup != 'n':
            tester.setup_test_students()
        
        # Start session
        start = input("Start session? (y/n, default y): ").strip().lower()
        if start != 'n':
            if not tester.start_motion_session(duration_hours=duration, motion_threshold=threshold):
                return False
        
        # Activity simulation
        activity = input("Simulate activity? (y/n, default y): ").strip().lower()
        if activity != 'n':
            tester.simulate_session_activity(duration_minutes=sim_minutes)
        
        # Manual capture
        manual = input("Test manual capture? (y/n, default y): ").strip().lower()
        if manual != 'n':
            tester.test_manual_teacher_capture()
        
        # Statistics
        stats = input("Show statistics? (y/n, default y): ").strip().lower()
        if stats != 'n':
            tester.get_final_session_statistics()
        
        # End session
        end = input("End session? (y/n, default y): ").strip().lower()
        if end != 'n':
            tester.end_motion_session()
        
        # Report
        report = input("Generate report? (y/n, default y): ").strip().lower()
        if report != 'n':
            tester.generate_session_report()
        
        print("✅ Interactive test completed")
        return True
        
    except Exception as e:
        print(f"❌ Interactive test failed: {e}")
        return False

# ==================== Main Test Menu ====================

def show_test_menu():
    """Show test menu options"""
    print("\n" + "=" * 60)
    print(" MOTION DETECTION SESSION LIFECYCLE TESTS")
    print("=" * 60)
    print("1. 🚀 Quick Session Test (start → end)")
    print("2. 🎭 Demo Session with Activity (3 min simulation)")
    print("3. 🎬 Complete Lifecycle Test (full simulation)")
    print("4. 📊 Test Session Statistics (existing session)")
    print("5. 🔥 Motion Events Stress Test")
    print("6. 🎮 Interactive Session Test")
    print("7. 🏥 Health Check Only")
    print("8. 🛑 Exit")
    print("=" * 60)

def main():
    """Main test execution"""
    while True:
        show_test_menu()
        
        choice = input("\nSelect test (1-8): ").strip()
        
        if choice == "1":
            print("\n" + "🚀" * 20)
            quick_session_test()
            
        elif choice == "2":
            print("\n" + "🎭" * 20)
            demo_session_with_activity()
            
        elif choice == "3":
            print("\n" + "🎬" * 20)
            tester = SessionLifecycleTest()
            tester.run_complete_session_lifecycle(simulation_minutes=5)
            
        elif choice == "4":
            print("\n" + "📊" * 20)
            test_session_statistics_only()
            
        elif choice == "5":
            print("\n" + "🔥" * 20)
            stress_test_motion_events()
            
        elif choice == "6":
            print("\n" + "🎮" * 20)
            interactive_session_test()
            
        elif choice == "7":
            print("\n" + "🏥" * 20)
            try:
                response = requests.get(f"{API_BASE_URL}/health")
                response.raise_for_status()
                data = response.json()
                print("✅ Server Health Check:")
                print(json.dumps(data, indent=2))
            except Exception as e:
                print(f"❌ Health check failed: {e}")
        
        elif choice == "8":
            print("\n👋 Goodbye!")
            break
            
        else:
            print("❌ Invalid choice, please try again")
        
        if choice != "8":
            input("\nPress Enter to continue...")

if __name__ == "__main__":
    print("🧪 Motion Detection Session Lifecycle Tester")
    print(f"🌐 API Server: {API_BASE_URL}")
    print(f"🏫 Test Class: {TEST_CLASS_ID}")
    print(f"👨‍🏫 Test Teacher: {TEST_TEACHER_EMAIL}")
    print(f"👥 Test Students: {len(TEST_STUDENT_IDS)}")
    
    # Quick health check first
    try:
        response = requests.get(f"{API_BASE_URL}/health", timeout=5)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Server Status: {data.get('status', 'unknown')}")
            print(f"🎯 Motion Detection: {data.get('motion_configuration', {}).get('motion_detection_enabled', 'unknown')}")
        else:
            print(f"⚠️ Server responded with status: {response.status_code}")
    except Exception as e:
        print(f"❌ Cannot connect to server: {e}")
        print("🔧 Please ensure the server is running and accessible")
        exit(1)
    
    main()