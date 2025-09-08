import { useState, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from './supabaseClient';

const TeacherDashboard = () => {
  const { user, signOut } = useAuth();
  const [classes, setClasses] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showStartSessionModal, setShowStartSessionModal] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState(null);
  const [newClass, setNewClass] = useState({
    subject_name: '',
    schedule: '',
  });
  const [sessionConfig, setSessionConfig] = useState({
    duration_hours: 2,
    motion_threshold: 0.1,
    cooldown_seconds: 30,
    on_time_limit_minutes: 30,
  });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef(null);

  // FastAPI URL จาก EnhancedTeacherDashboard
  const FASTAPI_URL = import.meta.env.VITE_FASTAPI_URL || 'http://localhost:8000';

  useEffect(() => {
    fetchTeacherClasses();
  }, [user]);

  const fetchTeacherClasses = async () => {
    if (!user) return;

    try {
      console.log('Fetching classes for user:', user.id);
      const { data, error } = await supabase
        .from('classes')
        .select('*')
        .eq('teacher_id', user.id);

      if (error) {
        console.error('Error fetching classes:', error);
        throw error;
      }

      console.log('Classes fetched:', data);
      setClasses(data || []);
    } catch (error) {
      console.error('Error in fetchTeacherClasses:', error);
      alert('เกิดข้อผิดพลาดในการโหลดข้อมูลคลาส: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const generateClassCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const createClass = async () => {
    if (!newClass.subject_name.trim()) {
      alert('กรุณากรอกชื่อวิชา');
      return;
    }

    setActionLoading(true);

    try {
      const classCode = generateClassCode();
      const classData = {
        subject_name: newClass.subject_name.trim(),
        description: newClass.description?.trim() || null,
        schedule: newClass.schedule.trim() || null,
        teacher_id: user.id,
        teacher_email: user.email,
        class_code: classCode,
      };

      console.log('Creating class with data:', classData);

      const { error } = await supabase.from('classes').insert([classData]);

      if (error) throw error;

      alert(`สร้างคลาสเรียนสำเร็จ!\nรหัสคลาส: ${classCode}`);
      setShowCreateModal(false);
      setNewClass({ subject_name: '', description: '', schedule: '' });
      fetchTeacherClasses();
    } catch (error) {
      console.error('Error creating class:', error);
      alert('เกิดข้อผิดพลาดในการสร้างคลาสเรียน: ' + error.message);
    } finally {
      setActionLoading(false);
    }
  };

  const startMotionDetectionSession = async () => {
    if (!selectedClassId) return;

    setActionLoading(true);

    try {
      // จับภาพจากกล้องถ้ามี
      let imageBlob = null;
      if (videoRef.current && isCapturing) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);

        imageBlob = await new Promise((resolve) => {
          canvas.toBlob(resolve, 'image/jpeg', 0.8);
        });
      }

      const formData = new FormData();
      formData.append('class_id', selectedClassId);
      formData.append('teacher_email', user.email);
      formData.append('duration_hours', sessionConfig.duration_hours.toString());
      formData.append('motion_threshold', sessionConfig.motion_threshold.toString());
      formData.append('cooldown_seconds', sessionConfig.cooldown_seconds.toString());
      formData.append('on_time_limit_minutes', sessionConfig.on_time_limit_minutes.toString());

      if (imageBlob) {
        formData.append('initial_image', imageBlob, 'initial.jpg');
      }

      const response = await fetch(`${FASTAPI_URL}/api/session/start-motion-detection`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to start motion detection session');
      }

      const result = await response.json();
      alert(
        `🎯 เริ่มเซสชัน Motion Detection สำเร็จ!\n\nSession ID: ${result.session_id}\nMotion Threshold: ${result.motion_threshold}\nCooldown: ${result.cooldown_seconds}s`
      );
      setShowStartSessionModal(false);
      stopCamera();
      fetchTeacherClasses();
    } catch (error) {
      console.error('Error starting motion detection session:', error);
      alert('เกิดข้อผิดพลาดในการเริ่มเซสชัน: ' + error.message);
    } finally {
      setActionLoading(false);
    }
  };

  const deleteClass = async (classId, className) => {
    if (!confirm(`คุณต้องการลบคลาส "${className}" ใช่หรือไม่?`)) {
      return;
    }

    setActionLoading(true);

    try {
      const { error } = await supabase.from('classes').delete().eq('class_id', classId);

      if (error) throw error;

      alert('ลบคลาสเรียนสำเร็จ');
      fetchTeacherClasses();
    } catch (error) {
      console.error('Error deleting class:', error);
      alert('เกิดข้อผิดพลาดในการลบคลาสเรียน: ' + error.message);
    } finally {
      setActionLoading(false);
    }
  };

  const copyClassCode = (classCode) => {
    navigator.clipboard.writeText(classCode);
    alert('คัดลอกรหัสคลาสแล้ว: ' + classCode);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCapturing(true);
        setCameraError('');
      }
    } catch (error) {
      console.error('Error starting camera:', error);
      setCameraError('ไม่สามารถเปิดกล้องได้: ' + error.message);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject;
      const tracks = stream.getTracks();
      tracks.forEach((track) => track.stop());
      videoRef.current.srcObject = null;
      setIsCapturing(false);
    }
  };

  const handleSignOut = async () => {
    if (confirm('คุณต้องการออกจากระบบใช่หรือไม่?')) {
      stopCamera();
      await signOut();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">กำลังโหลดข้อมูล...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">แดชบอร์ดอาจารย์</h1>
              <p className="text-gray-600">ยินดีต้อนรับ, {user?.user_metadata?.full_name || user?.email}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
            >
              ออกจากระบบ
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <div className="flex items-center">
              <div className="p-3 bg-blue-100 rounded-lg">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">คลาสที่สอน</p>
                <p className="text-2xl font-bold text-gray-900">{classes.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border p-6">
            <div className="flex items-center">
              <div className="p-3 bg-green-100 rounded-lg">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">รหัสคลาสที่สร้าง</p>
                <p className="text-2xl font-bold text-gray-900">{classes.length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Classes Section */}
        <div className="bg-white rounded-lg shadow-sm border">
          <div className="p-6 border-b border-gray-200">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">คลาสเรียนของฉัน</h2>
              <button
                onClick={() => setShowCreateModal(true)}
                disabled={actionLoading}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                สร้างคลาสใหม่
              </button>
            </div>
          </div>

          <div className="p-6">
            {classes.length === 0 ? (
              <div className="text-center py-12">
                <svg className="mx-auto h-16 w-16 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1}
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
                <h3 className="text-lg font-medium text-gray-900 mb-2">ยังไม่มีคลาสเรียน</h3>
                <p className="text-gray-500 mb-4">เริ่มต้นโดยการสร้างคลาสเรียนแรกของคุณ</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {classes.map((cls) => (
                  <div key={cls.class_id} className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">{cls.subject_name}</h3>
                        <p className="text-sm text-gray-600 mb-3">เวลาเรียน: {cls.schedule || 'ไม่ระบุ'}</p>
                        <div className="flex items-center space-x-4">
                          <span
                            className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 cursor-pointer hover:bg-blue-200 transition-colors"
                            onClick={() => copyClassCode(cls.class_code)}
                            title="คลิกเพื่อคัดลอก"
                          >
                            📋 {cls.class_code}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => {
                            setSelectedClassId(cls.class_id);
                            setShowStartSessionModal(true);
                          }}
                          className="bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 transition-colors font-semibold"
                        >
                          เริ่มเซสชันเช็คชื่อ
                        </button>
                        <button
                          onClick={() => deleteClass(cls.class_id, cls.subject_name)}
                          disabled={actionLoading}
                          className="text-red-500 hover:text-red-700 p-2 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                          title="ลบคลาส"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div className="border-t pt-4">
                      <p className="text-xs text-gray-500 mb-2">
                        สร้างเมื่อ: {new Date(cls.created_at).toLocaleDateString('th-TH')}
                      </p>
                      <p className="text-sm text-blue-600">
                        แชร์รหัส <strong>{cls.class_code}</strong> ให้นักเรียนเพื่อเข้าร่วมคลาส
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create Class Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">สร้างคลาสเรียนใหม่</h3>

              <div className="space-y-4">
                <div>
                  <label htmlFor="subjectName" className="block text-sm font-medium text-gray-700 mb-2">
                    ชื่อวิชา *
                  </label>
                  <input
                    id="subjectName"
                    type="text"
                    value={newClass.subject_name}
                    onChange={(e) => setNewClass((prev) => ({ ...prev, subject_name: e.target.value }))}
                    placeholder="เช่น วิทยาการคอมพิวเตอร์ 101"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    maxLength={100}
                  />
                </div>

                <div>
                  <label htmlFor="schedule" className="block text-sm font-medium text-gray-700 mb-2">
                    เวลาเรียน
                  </label>
                  <input
                    id="schedule"
                    type="text"
                    value={newClass.schedule}
                    onChange={(e) => setNewClass((prev) => ({ ...prev, schedule: e.target.value }))}
                    placeholder="เช่น จันทร์ 9:00-12:00"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    maxLength={100}
                  />
                </div>
              </div>

              <div className="flex space-x-3 mt-6">
                <button
                  onClick={createClass}
                  disabled={actionLoading || !newClass.subject_name.trim()}
                  className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {actionLoading ? 'กำลังสร้าง...' : 'สร้างคลาส'}
                </button>
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setNewClass({ subject_name: '', schedule: '' });
                  }}
                  disabled={actionLoading}
                  className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400 transition-colors disabled:opacity-50"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Start Motion Detection Session Modal */}
      {showStartSessionModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold text-gray-900">เริ่มเซสชัน Motion Detection</h3>
                <button
                  onClick={() => {
                    setShowStartSessionModal(false);
                    setSelectedClassId(null);
                    stopCamera();
                  }}
                  className="text-gray-400 hover:text-gray-600 p-2"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">ระยะเวลาเซสชัน (ชั่วโมง)</label>
                    <input
                      type="number"
                      min="1"
                      max="8"
                      value={sessionConfig.duration_hours}
                      onChange={(e) =>
                        setSessionConfig((prev) => ({ ...prev, duration_hours: parseInt(e.target.value) }))
                      }
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Motion Threshold (0.01-1.0)</label>
                    <input
                      type="number"
                      min="0.01"
                      max="1.0"
                      step="0.01"
                      value={sessionConfig.motion_threshold}
                      onChange={(e) =>
                        setSessionConfig((prev) => ({ ...prev, motion_threshold: parseFloat(e.target.value) }))
                      }
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Cooldown (วินาที)</label>
                    <input
                      type="number"
                      min="10"
                      max="300"
                      value={sessionConfig.cooldown_seconds}
                      onChange={(e) =>
                        setSessionConfig((prev) => ({ ...prev, cooldown_seconds: parseInt(e.target.value) }))
                      }
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">เวลาที่ถือว่ามาทันเวลา (นาที)</label>
                    <input
                      type="number"
                      min="5"
                      max="60"
                      value={sessionConfig.on_time_limit_minutes}
                      onChange={(e) =>
                        setSessionConfig((prev) => ({ ...prev, on_time_limit_minutes: parseInt(e.target.value) }))
                      }
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    กล้องสำหรับ Initial Capture (ไม่บังคับ)
                  </label>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
                    {!isCapturing ? (
                      <div className="text-center">
                        <svg
                          className="mx-auto h-12 w-12 text-gray-400 mb-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                          />
                        </svg>
                        <button
                          onClick={startCamera}
                          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                        >
                          📹 เปิดกล้อง
                        </button>
                        {cameraError && <p className="text-red-600 text-sm mt-2">{cameraError}</p>}
                      </div>
                    ) : (
                      <div className="text-center">
                        <video
                          ref={videoRef}
                          autoPlay
                          playsInline
                          className="mx-auto rounded-lg mb-4 max-w-full h-48 object-cover"
                        />
                        <button
                          onClick={stopCamera}
                          className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
                        >
                          🛑 ปิดกล้อง
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h4 className="font-medium text-green-800 mb-2">ข้อมูลการตั้งค่า:</h4>
                  <ul className="text-sm text-green-700 space-y-1">
                    <li>• Motion Threshold: ค่าความไว {sessionConfig.motion_threshold} (ยิ่งต่ำยิ่งไว)</li>
                    <li>• Cooldown: หน่วงเวลา {sessionConfig.cooldown_seconds} วินาที ระหว่างการถ่ายภาพ</li>
                    <li>• ระบบจะทำงานเป็นเวลา {sessionConfig.duration_hours} ชั่วโมง</li>
                    <li>• นักเรียนที่มาภายใน {sessionConfig.on_time_limit_minutes} นาทีแรก = มาทันเวลา</li>
                  </ul>
                </div>
              </div>

              <div className="flex space-x-3 mt-8">
                <button
                  onClick={startMotionDetectionSession}
                  disabled={actionLoading}
                  className="flex-1 bg-green-600 text-white py-3 px-6 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                >
                  {actionLoading ? (
                    <div className="flex items-center justify-center">
                      <svg
                        className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      กำลังเริ่มเซสชัน...
                    </div>
                  ) : (
                    '🎯 เริ่ม Motion Detection'
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowStartSessionModal(false);
                    setSelectedClassId(null);
                    stopCamera();
                  }}
                  disabled={actionLoading}
                  className="flex-1 bg-gray-300 text-gray-700 py-3 px-6 rounded-lg hover:bg-gray-400 transition-colors disabled:opacity-50 font-semibold"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherDashboard;