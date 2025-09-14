import { useState, useEffect, useRef } from 'react'
import { useAuth } from './AuthContext'
import { supabase } from './supabaseClient'
import ClassCodeDisplay from './ClassCodeDisplay'
import LiveVideoStream from './LiveVideoStream'
import ClassDetailView from './ClassDetailView' // เพิ่ม import

const EnhancedTeacherDashboard = () => {
  const { user, signOut } = useAuth()
  const [classes, setClasses] = useState([])
  const [sessions, setSessions] = useState([])
  const [currentSession, setCurrentSession] = useState(null)
  const [attendanceRecords, setAttendanceRecords] = useState([])
  const [motionStats, setMotionStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  
  // เพิ่ม state สำหรับ Class Detail View
  const [selectedClass, setSelectedClass] = useState(null)
  const [showClassDetail, setShowClassDetail] = useState(false)
  
  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showStartSessionModal, setShowStartSessionModal] = useState(false)
  const [showClassCodeModal, setShowClassCodeModal] = useState(null)
  const [showSessionDetailsModal, setShowSessionDetailsModal] = useState(null)
  const [showManualCaptureModal, setShowManualCaptureModal] = useState(false)
  
  // Form states
  const [newClass, setNewClass] = useState({
    subject_name: '',
    description: '',
    schedule: ''
  })
  const [sessionConfig, setSessionConfig] = useState({
    duration_hours: 2,
    motion_threshold: 0.1,
    cooldown_seconds: 30,
    on_time_limit_minutes: 30
  })

  // Video/Camera states
  const videoRef = useRef(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [cameraError, setCameraError] = useState('')

  // FastAPI URL
  const FASTAPI_URL = import.meta.env.VITE_FASTAPI_URL || 'http://localhost:8000'

  // Function สำหรับเปิด Class Detail View
  const handleClassClick = (classData) => {
    setSelectedClass(classData)
    setShowClassDetail(true)
  }

  // Function สำหรับกลับจาก Class Detail View
  const handleBackFromClassDetail = () => {
    setShowClassDetail(false)
    setSelectedClass(null)
    // Refresh data เมื่อกลับมา
    fetchTeacherData()
  }

  useEffect(() => {
    // Debug user information
    console.log('=== User Debug Info ===')
    console.log('Full user object:', user)
    console.log('user.email:', user?.email)
    console.log('user.user_metadata:', user?.user_metadata)
    console.log('user.app_metadata:', user?.app_metadata)
    console.log('========================')
    
    fetchTeacherData()
    const interval = setInterval(fetchTeacherData, 30000) // Refresh every 30s
    return () => clearInterval(interval)
  }, [user])

  useEffect(() => {
    if (currentSession) {
      fetchMotionStats()
      const statsInterval = setInterval(fetchMotionStats, 10000) // Every 10s
      return () => clearInterval(statsInterval)
    }
  }, [currentSession])

  const fetchTeacherData = async () => {
    if (!user) return

    try {
      console.log('🔍 Fetching data for user:', { id: user.id, email: user.email })

      // ตรวจสอบข้อมูลผู้ใช้ใน database
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (userError) {
        console.error('User data error:', userError)
      } else {
        console.log('User data from database:', userData)
      }

      // Fetch classes
      const { data: classesData, error: classesError } = await supabase
        .from('classes')
        .select('*')
        .eq('teacher_id', user.id)
        .order('created_at', { ascending: false })

      if (classesError) throw classesError
      console.log(`📚 Found ${classesData?.length || 0} classes`)
      setClasses(classesData || [])

      // Fetch active sessions with better error handling
      const { data: sessionsData, error: sessionsError } = await supabase
        .from('attendance_sessions')
        .select(`
          *,
          classes!inner(subject_name, class_code)
        `)
        .eq('teacher_email', user.email)
        .eq('status', 'active')
        .order('start_time', { ascending: false })

      if (sessionsError) {
        console.error('Sessions query error:', sessionsError)
        // ลองใช้ query แบบง่ายกว่า
        const { data: simpleSessionsData, error: simpleError } = await supabase
          .from('attendance_sessions')
          .select('*')
          .eq('teacher_email', user.email)
          .eq('status', 'active')
          .order('start_time', { ascending: false })
        
        if (simpleError) {
          throw simpleError
        }
        
        console.log('📊 Using simple sessions query:', simpleSessionsData)
        setSessions(simpleSessionsData || [])
        
        // ดึงข้อมูล classes แยก
        if (simpleSessionsData && simpleSessionsData.length > 0) {
          const sessionWithClasses = []
          for (const session of simpleSessionsData) {
            const { data: classData } = await supabase
              .from('classes')
              .select('subject_name, class_code')
              .eq('class_id', session.class_id)
              .single()
            
            sessionWithClasses.push({
              ...session,
              classes: classData || { subject_name: 'Unknown', class_code: 'N/A' }
            })
          }
          setSessions(sessionWithClasses)
        }
      } else {
        console.log(`📊 Found ${sessionsData?.length || 0} sessions`)
        setSessions(sessionsData || [])
      }

      // Set current session with motion detection preference
      const activeSessions = sessionsData || []
      if (activeSessions.length > 0) {
        // ให้ความสำคัญกับ motion detection sessions
        const motionSession = activeSessions.find(s => s.session_type === 'motion_detection')
        const selectedSession = motionSession || activeSessions[0]
        
        console.log(`🎯 Selected session:`, {
          id: selectedSession.id,
          type: selectedSession.session_type,
          class: selectedSession.classes?.subject_name
        })
        
        setCurrentSession(selectedSession)
        await fetchAttendanceRecords(selectedSession.id)
      } else {
        console.log('ℹ️ No active sessions found')
        setCurrentSession(null)
        setAttendanceRecords([])
      }

    } catch (error) {
      console.error('❌ Error fetching teacher data:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchAttendanceRecords = async (sessionId) => {
    try {
      console.log(`🔍 Fetching attendance for session: ${sessionId}`)
      
      // ใช้ query ที่ปลอดภัยโดยไม่พึ่ง foreign key
      const { data: records, error } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('session_id', sessionId)
        .order('check_in_time', { ascending: false })

      if (error) {
        console.error('❌ Supabase attendance error:', error)
        throw error
      }

      console.log(`📊 Found ${records?.length || 0} attendance records`)

      // เพิ่มข้อมูล users แยกเป็น batch เพื่อประสิทธิภาพดีขึ้น
      const enrichedRecords = []
      
      if (records && records.length > 0) {
        // สร้างรายการ email ที่ไม่ซ้ำ
        const uniqueEmails = [...new Set(records.map(r => r.student_email))]
        
        // ดึงข้อมูล users ทั้งหมดในครั้งเดียว
        const { data: usersData, error: usersError } = await supabase
          .from('users')
          .select('email, full_name, school_id')
          .in('email', uniqueEmails)

        if (usersError) {
          console.warn('⚠️ Error fetching users data:', usersError)
        }

        // สร้าง Map สำหรับ lookup ที่เร็วขึ้น
        const usersMap = new Map()
        if (usersData) {
          usersData.forEach(user => {
            usersMap.set(user.email, user)
          })
        }

        // รวมข้อมูล attendance กับ users
        for (const record of records) {
          const userData = usersMap.get(record.student_email)
          
          enrichedRecords.push({
            ...record,
            users: userData || { 
              full_name: 'Unknown User', 
              school_id: record.student_id || 'N/A',
              email: record.student_email
            }
          })
        }
      }

      setAttendanceRecords(enrichedRecords)
      console.log(`✅ Successfully loaded ${enrichedRecords.length} attendance records`)
      
    } catch (error) {
      console.error('❌ Error fetching attendance records:', error)
      setAttendanceRecords([]) // ตั้งค่าเป็น array ว่างเมื่อมีข้อผิดพลาด
    }
  }

  const handleManualCaptureFromVideo = async (imageBlob) => {
    if (!currentSession) {
      alert('ไม่พบเซสชันที่ใช้งานอยู่')
      return
    }

    setActionLoading(true)

    try {
      const formData = new FormData()
      formData.append('session_id', currentSession.id)
      formData.append('image', imageBlob, 'manual_capture.jpg')
      formData.append('force_capture', 'true')

      const response = await fetch(`${FASTAPI_URL}/api/motion/manual-capture`, {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || 'Failed to take manual capture')
      }

      const result = await response.json()
      
      alert(`📸 Manual Capture สำเร็จ!\n\nพบใบหน้า: ${result.faces_detected} คน\nPriority: ${result.processing_priority}`)
      
      // Refresh attendance records
      setTimeout(() => {
        fetchAttendanceRecords(currentSession.id)
      }, 2000)
      
    } catch (error) {
      console.error('Error taking manual capture:', error)
      alert('เกิดข้อผิดพลาดในการถ่ายภาพ: ' + error.message)
    } finally {
      setActionLoading(false)
    }
  }

  const fetchMotionStats = async () => {
    if (!currentSession) return

    try {
      console.log(`🔍 Fetching motion stats for session: ${currentSession.id}`)
      console.log(`🔍 Session type: ${currentSession.session_type || 'unknown'}`)
      
      const response = await fetch(`${FASTAPI_URL}/api/motion/session/${currentSession.id}/live-stats`)
      
      console.log(`📡 Motion API Response status: ${response.status}`)
      
      if (response.ok) {
        const data = await response.json()
        console.log('✅ Motion stats received:', data)
        
        // ตรวจสอบว่าเป็น motion detection session จริงไหม
        if (data.session_type === 'motion_detection' || data.success) {
          setMotionStats(data)
        } else {
          console.log(`ℹ️ Session is not motion detection type: ${data.session_type}`)
          setMotionStats({
            ...data,
            isMotionSession: false
          })
        }
      } else {
        const errorText = await response.text()
        console.error(`❌ Motion API error: ${response.status}`, errorText)
        setMotionStats(null)
      }
    } catch (error) {
      console.error('❌ Error fetching motion stats:', error)
      setMotionStats(null)
    }
  }

  const generateClassCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let result = ''
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  const createClass = async () => {
    if (!newClass.subject_name.trim()) {
      alert('กรุณากรอกชื่อวิชา')
      return
    }

    setActionLoading(true)

    try {
      const classCode = generateClassCode()
      
      const classData = {
        subject_name: newClass.subject_name.trim(),
        description: newClass.description?.trim() || null,
        schedule: newClass.schedule.trim() || null,
        teacher_id: user.id,
        teacher_email: user.email,
        class_code: classCode
      }

      const { error } = await supabase
        .from('classes')
        .insert([classData])

      if (error) throw error

      setShowClassCodeModal({
        code: classCode,
        name: newClass.subject_name
      })
      
      setShowCreateModal(false)
      setNewClass({ subject_name: '', description: '', schedule: '' })
      fetchTeacherData()
    } catch (error) {
      console.error('Error creating class:', error)
      alert('เกิดข้อผิดพลาดในการสร้างคลาสเรียน: ' + error.message)
    } finally {
      setActionLoading(false)
    }
  }

  const startMotionDetectionSession = async (classId) => {
    setActionLoading(true)

    try {
      // Get initial camera image if available
      let imageBlob = null
      if (videoRef.current && isCapturing) {
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')
        canvas.width = videoRef.current.videoWidth
        canvas.height = videoRef.current.videoHeight
        context.drawImage(videoRef.current, 0, 0)
        
        imageBlob = await new Promise(resolve => {
          canvas.toBlob(resolve, 'image/jpeg', 0.8)
        })
      }

      const formData = new FormData()
      formData.append('class_id', classId)
      formData.append('teacher_email', user.email)
      formData.append('duration_hours', sessionConfig.duration_hours.toString())
      formData.append('motion_threshold', sessionConfig.motion_threshold.toString())
      formData.append('cooldown_seconds', sessionConfig.cooldown_seconds.toString())
      formData.append('on_time_limit_minutes', sessionConfig.on_time_limit_minutes.toString())
      
      if (imageBlob) {
        formData.append('initial_image', imageBlob, 'initial.jpg')
      }

      const response = await fetch(`${FASTAPI_URL}/api/session/start-motion-detection`, {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || 'Failed to start motion detection session')
      }

      const result = await response.json()
      
      alert(`🎯 เริ่มเซสชัน Motion Detection สำเร็จ!\n\nSession ID: ${result.session_id}\nMotion Threshold: ${result.motion_threshold}\nCooldown: ${result.cooldown_seconds}s`)
      
      setShowStartSessionModal(false)
      fetchTeacherData()
      
    } catch (error) {
      console.error('Error starting motion detection session:', error)
      alert('เกิดข้อผิดพลาดในการเริ่มเซสชัน: ' + error.message)
    } finally {
      setActionLoading(false)
    }
  }

  const endSession = async (sessionId) => {
    if (!confirm('คุณต้องการจบเซสชันนี้หรือไม่?')) return

    setActionLoading(true)

    try {
      console.log(`🛑 Ending session: ${sessionId}`)
      
      // ลองใช้ endpoint ที่เหมาะสมตาม session type
      let endpoint = `${FASTAPI_URL}/api/session/${sessionId}/end`
      
      // ถ้าเป็น motion detection session ใช้ endpoint เฉพาะ
      if (currentSession?.session_type === 'motion_detection') {
        endpoint = `${FASTAPI_URL}/api/session/${sessionId}/end-motion`
      }
      
      console.log(`📡 Using endpoint: ${endpoint}`)
      
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      console.log(`📡 End session response status: ${response.status}`)

      if (!response.ok) {
        const errorData = await response.json()
        console.error('❌ End session error:', errorData)
        throw new Error(errorData.detail || `Failed to end session (${response.status})`)
      }

      const result = await response.json()
      console.log('✅ Session ended successfully:', result)

      alert(`✅ จบเซสชันสำเร็จ!\n\nSession ID: ${sessionId}\nType: ${result.session_type || 'Unknown'}`)
      
      // รีเฟรชข้อมูล
      fetchTeacherData()
      
    } catch (error) {
      console.error('❌ Error ending session:', error)
      alert(`❌ เกิดข้อผิดพลาดในการจบเซสชัน:\n\n${error.message}`)
    } finally {
      setActionLoading(false)
    }
  }

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        } 
      })
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        setIsCapturing(true)
        setCameraError('')
      }
    } catch (error) {
      console.error('Error starting camera:', error)
      setCameraError('ไม่สามารถเปิดกล้องได้: ' + error.message)
    }
  }

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject
      const tracks = stream.getTracks()
      tracks.forEach(track => track.stop())
      videoRef.current.srcObject = null
      setIsCapturing(false)
    }
  }

  const takeManualCapture = async () => {
    if (!currentSession) {
      alert('ไม่พบเซสชันที่ใช้งานอยู่')
      return
    }

    if (!videoRef.current || !isCapturing) {
      alert('กรุณาเปิดกล้องก่อน')
      return
    }

    setActionLoading(true)

    try {
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      canvas.width = videoRef.current.videoWidth
      canvas.height = videoRef.current.videoHeight
      context.drawImage(videoRef.current, 0, 0)
      
      const imageBlob = await new Promise(resolve => {
        canvas.toBlob(resolve, 'image/jpeg', 0.8)
      })

      const formData = new FormData()
      formData.append('session_id', currentSession.id)
      formData.append('image', imageBlob, 'manual_capture.jpg')
      formData.append('force_capture', 'true')

      const response = await fetch(`${FASTAPI_URL}/api/motion/manual-capture`, {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || 'Failed to take manual capture')
      }

      const result = await response.json()
      
      alert(`📸 Manual Capture สำเร็จ!\n\nพบใบหน้า: ${result.faces_detected} คน\nPriority: ${result.processing_priority}\nQueue Size: ${result.queue_size}`)
      
      // Refresh attendance records
      setTimeout(() => {
        fetchAttendanceRecords(currentSession.id)
      }, 2000)
      
    } catch (error) {
      console.error('Error taking manual capture:', error)
      alert('เกิดข้อผิดพลาดในการถ่ายภาพ: ' + error.message)
    } finally {
      setActionLoading(false)
    }
  }

  const deleteClass = async (classId, className) => {
    if (!confirm(`คุณต้องการลบคลาส "${className}" ใช่หรือไม่?`)) return

    setActionLoading(true)

    try {
      const { error } = await supabase
        .from('classes')
        .delete()
        .eq('class_id', classId)

      if (error) throw error

      alert('ลบคลาสเรียนสำเร็จ')
      fetchTeacherData()
    } catch (error) {
      console.error('Error deleting class:', error)
      alert('เกิดข้อผิดพลาดในการลบคลาสเรียน: ' + error.message)
    } finally {
      setActionLoading(false)
    }
  }

  const handleSignOut = async () => {
    if (confirm('คุณต้องการออกจากระบบใช่หรือไม่?')) {
      stopCamera()
      await signOut()
    }
  }

  // ถ้ากำลังแสดง Class Detail View ให้แสดง component นั้น
  if (showClassDetail && selectedClass) {
    return (
      <ClassDetailView 
        classData={selectedClass} 
        onBack={handleBackFromClassDetail}
      />
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">กำลังโหลดข้อมูล...</p>
        </div>
      </div>
    )
  }

  return ( 
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-lg border-b border-blue-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">🎯 Enhanced Teacher Dashboard</h1>
              <p className="text-gray-600 mt-1">Motion Detection Attendance System - {user?.user_metadata?.full_name || user?.email}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 transition-colors flex items-center space-x-2 shadow-md"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span>ออกจากระบบ</span>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Current Session Status */}
        {currentSession && (
          <div className="bg-gradient-to-r from-green-500 to-green-600 rounded-xl shadow-lg text-white p-6 mb-8">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold">🎯 เซสชันที่ใช้งานอยู่</h3>
                <p className="mt-1">{currentSession.classes?.subject_name} ({currentSession.classes?.class_code})</p>
                <p className="text-green-100 text-sm">
                  เริ่มเมื่อ: {new Date(currentSession.start_time).toLocaleString('th-TH')}
                </p>
                {currentSession.session_type && (
                  <p className="text-green-100 text-sm">
                    ประเภท: {currentSession.session_type === 'motion_detection' ? 'Motion Detection' : currentSession.session_type}
                  </p>
                )}
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowManualCaptureModal(true)}
                  disabled={currentSession.session_type !== 'motion_detection'}
                  className="bg-white text-green-600 px-4 py-2 rounded-lg hover:bg-green-50 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  📸 Manual Capture
                </button>
                <button
                  onClick={() => setShowSessionDetailsModal(currentSession)}
                  className="bg-green-700 text-white px-4 py-2 rounded-lg hover:bg-green-800 transition-colors"
                >
                  📊 ดูรายละเอียด
                </button>
                <button
                  onClick={() => endSession(currentSession.id)}
                  disabled={actionLoading}
                  className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  🛑 จบเซสชัน
                </button>
              </div>
            </div>
              
            {/* Motion Stats */}
            {motionStats && currentSession && (
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-green-700 rounded-lg p-3">
                  <p className="text-green-100 text-xs">
                    {motionStats.session_type === 'motion_detection' ? 'Motion Events' : 'Total Events'}
                  </p>
                  <p className="text-xl font-bold">{motionStats.live_stats?.motion_events || 0}</p>
                </div>
                <div className="bg-green-700 rounded-lg p-3">
                  <p className="text-green-100 text-xs">
                    {motionStats.session_type === 'motion_detection' ? 'Snapshots' : 'Captures'}
                  </p>
                  <p className="text-xl font-bold">{motionStats.live_stats?.snapshots_taken || 0}</p>
                </div>
                <div className="bg-green-700 rounded-lg p-3">
                  <p className="text-green-100 text-xs">Efficiency</p>
                  <p className="text-xl font-bold">
                    {Math.round((motionStats.live_stats?.snapshot_efficiency || 0) * 100)}%
                  </p>
                </div>
                <div className="bg-green-700 rounded-lg p-3">
                  <p className="text-green-100 text-xs">Queue Size</p>
                  <p className="text-xl font-bold">{motionStats.processing?.total_queue_size || 0}</p>
                </div>
                
                {/* แสดง session type สำหรับ debug */}
                {motionStats.session_type && motionStats.session_type !== 'motion_detection' && (
                  <div className="col-span-2 md:col-span-4 bg-yellow-600 rounded-lg p-3">
                    <p className="text-yellow-100 text-xs">Session Type</p>
                    <p className="text-sm font-bold text-yellow-100">
                      {motionStats.session_type} (Limited motion features)
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mb-8">
          <LiveVideoStream
            currentSession={currentSession}
            isSessionActive={currentSession !== null}
            onManualCapture={handleManualCaptureFromVideo}
            motionStats={motionStats}
          />
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-lg border border-blue-200 p-6 hover:shadow-xl transition-shadow">
            <div className="flex items-center">
              <div className="p-4 bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <div className="ml-6">
                <p className="text-sm font-medium text-gray-600">คลาสที่สอน</p>
                <p className="text-3xl font-bold text-gray-900">{classes.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg border border-green-200 p-6 hover:shadow-xl transition-shadow">
            <div className="flex items-center">
              <div className="p-4 bg-gradient-to-r from-green-500 to-green-600 rounded-lg">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="ml-6">
                <p className="text-sm font-medium text-gray-600">เซสชันที่ใช้งาน</p>
                <p className="text-3xl font-bold text-gray-900">{sessions.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg border border-yellow-200 p-6 hover:shadow-xl transition-shadow">
            <div className="flex items-center">
              <div className="p-4 bg-gradient-to-r from-yellow-500 to-yellow-600 rounded-lg">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                </svg>
              </div>
              <div className="ml-6">
                <p className="text-sm font-medium text-gray-600">เช็คชื่อวันนี้</p>
                <p className="text-3xl font-bold text-gray-900">{attendanceRecords.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg border border-purple-200 p-6 hover:shadow-xl transition-shadow">
            <div className="flex items-center">
              <div className="p-4 bg-gradient-to-r from-purple-500 to-purple-600 rounded-lg">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div className="ml-6">
                <p className="text-sm font-medium text-gray-600">Motion Events</p>
                <p className="text-3xl font-bold text-gray-900">{motionStats?.live_stats?.motion_events || 0}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 mb-8">
          <h3 className="text-xl font-bold text-gray-900 mb-4">🚀 Quick Actions</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg flex items-center justify-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>สร้างคลาสใหม่</span>
            </button>
            
            <button
              onClick={() => setShowStartSessionModal(true)}
              disabled={currentSession !== null}
              className="bg-gradient-to-r from-green-600 to-green-700 text-white p-4 rounded-lg hover:from-green-700 hover:to-green-800 transition-all shadow-lg flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>เริ่ม Motion Detection</span>
            </button>
            
            <button
              onClick={() => setShowManualCaptureModal(true)}
              disabled={!currentSession}
              className="bg-gradient-to-r from-purple-600 to-purple-700 text-white p-4 rounded-lg hover:from-purple-700 hover:to-purple-800 transition-all shadow-lg flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              </svg>
              <span>Manual Capture</span>
            </button>
          </div>
        </div>

        {/* Classes Section */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 mb-8">
          <div className="p-8 border-b border-gray-200">
            <h2 className="text-2xl font-bold text-gray-900">📚 คลาสเรียนของฉัน</h2>
            <p className="text-gray-600 mt-1">จัดการคลาสเรียนและรหัสเข้าร่วม - คลิกที่คลาสเพื่อดูรายละเอียด</p>
          </div>

          <div className="p-8">
            {classes.length === 0 ? (
              <div className="text-center py-16">
                <div className="bg-blue-50 rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-6">
                  <svg className="w-12 h-12 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3">ยังไม่มีคลาสเรียน</h3>
                <p className="text-gray-500 mb-6">เริ่มต้นโดยการสร้างคลาสเรียนแรกของคุณ</p>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-8 py-4 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg"
                >
                  📚 สร้างคลาสแรก
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {classes.map((cls) => (
                  <div 
                    key={cls.class_id} 
                    className="bg-gradient-to-br from-white to-gray-50 border-2 border-gray-200 rounded-xl p-6 hover:shadow-xl hover:border-blue-300 transition-all group cursor-pointer"
                    onClick={() => handleClassClick(cls)} // เพิ่มการคลิก
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors">
                          {cls.subject_name}
                        </h3>
                        {cls.description && (
                          <p className="text-sm text-gray-600 mb-3 line-clamp-2">{cls.description}</p>
                        )}
                        <div className="flex items-center text-sm text-gray-600 mb-4">
                          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {cls.schedule || 'ไม่ระบุเวลาเรียน'}
                        </div>
                        
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs text-blue-600 font-medium">รหัสคลาส</p>
                              <p className="text-lg font-bold text-blue-800 font-mono">{cls.class_code}</p>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation() // ป้องกันไม่ให้ trigger การคลิกของ card
                                setShowClassCodeModal({
                                  code: cls.class_code,
                                  name: cls.subject_name
                                })
                              }}
                              className="text-blue-600 hover:text-blue-800 p-1"
                              title="แชร์รหัสคลาส"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* เพิ่มข้อความบอกให้คลิก */}
                        <div className="text-center py-2 bg-gray-50 rounded-lg border border-dashed border-gray-300 group-hover:bg-blue-50 group-hover:border-blue-300 transition-colors">
                          <p className="text-sm text-gray-500 group-hover:text-blue-600 transition-colors">
                            📊 คลิกเพื่อดูข้อมูลการเช็คชื่อ
                          </p>
                        </div>
                      </div>
                      
                      <div className="ml-4 flex flex-col space-y-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation() // ป้องกันไม่ให้ trigger การคลิกของ card
                            setShowStartSessionModal(cls.class_id)
                          }}
                          disabled={currentSession !== null}
                          className="text-green-600 hover:text-green-800 p-2 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title="เริ่ม Motion Detection"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation() // ป้องกันไม่ให้ trigger การคลิกของ card
                            deleteClass(cls.class_id, cls.subject_name)
                          }}
                          disabled={actionLoading}
                          className="text-red-500 hover:text-red-700 p-2 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                          title="ลบคลาส"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div className="border-t pt-4">
                      <p className="text-xs text-gray-500">
                        สร้างเมื่อ: {new Date(cls.created_at).toLocaleDateString('th-TH', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Attendance Records */}
        {currentSession && (
          <div className="bg-white rounded-xl shadow-lg border border-gray-200">
            <div className="p-8 border-b border-gray-200">
              <h2 className="text-2xl font-bold text-gray-900">👥 บันทึกการเข้าเรียน</h2>
              <p className="text-gray-600 mt-1">รายชื่อนักเรียนที่เช็คชื่อแล้ว - เซสชันปัจจุบัน</p>
            </div>

            <div className="p-8">
              {attendanceRecords.length === 0 ? (
                <div className="text-center py-12">
                  <div className="bg-gray-50 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">ยังไม่มีการเช็คชื่อ</h3>
                  <p className="text-gray-500">รอให้ระบบ Motion Detection ตรวจจับนักเรียน หรือใช้ Manual Capture</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          นักเรียน
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          เวลาเช็คชื่อ
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          สถานะ
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          วิธีการตรวจจับ
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          คะแนนความแม่นยำ
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {attendanceRecords.map((record) => (
                        <tr key={record.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="flex-shrink-0 h-10 w-10">
                                <div className="h-10 w-10 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center">
                                  <span className="text-sm font-medium text-white">
                                    {record.users?.full_name?.charAt(0) || record.student_id?.charAt(0)}
                                  </span>
                                </div>
                              </div>
                              <div className="ml-4">
                                <div className="text-sm font-medium text-gray-900">
                                  {record.users?.full_name || 'ไม่ระบุชื่อ'}
                                </div>
                                <div className="text-sm text-gray-500">
                                  {record.student_id}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {new Date(record.check_in_time).toLocaleString('th-TH')}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              record.status === 'present' 
                                ? 'bg-green-100 text-green-800'
                                : record.status === 'late'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {record.status === 'present' ? '✅ มาเรียน' : 
                               record.status === 'late' ? '⏰ มาสาย' : '❌ ขาดเรียน'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            <span className={`inline-flex px-2 py-1 text-xs rounded-full ${
                              record.detection_method?.includes('motion') 
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-purple-100 text-purple-800'
                            }`}>
                              {record.detection_method === 'motion_triggered' ? '🚶 Motion Detection' :
                               record.detection_method === 'manual_teacher_motion' ? '📸 Manual Capture' :
                               record.detection_method === 'motion_session_start' ? '🎯 Session Start' :
                               record.detection_method || 'Unknown'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            <div className="flex items-center">
                              <div className="flex-1 bg-gray-200 rounded-full h-2 mr-2">
                                <div 
                                  className="bg-gradient-to-r from-green-500 to-green-600 h-2 rounded-full" 
                                  style={{ width: `${(record.face_match_score || 0) * 100}%` }}
                                ></div>
                              </div>
                              <span className="text-xs font-medium">
                                {Math.round((record.face_match_score || 0) * 100)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create Class Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            <div className="p-8">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-bold text-gray-900">📚 สร้างคลาสเรียนใหม่</h3>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="text-gray-400 hover:text-gray-600 p-2"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="space-y-6">
                <div>
                  <label htmlFor="subjectName" className="block text-sm font-semibold text-gray-700 mb-2">
                    ชื่อวิชา *
                  </label>
                  <input
                    id="subjectName"
                    type="text"
                    value={newClass.subject_name}
                    onChange={(e) => setNewClass(prev => ({ ...prev, subject_name: e.target.value }))}
                    placeholder="เช่น วิทยาการคอมพิวเตอร์ 101"
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                    maxLength={100}
                  />
                </div>

                <div>
                  <label htmlFor="description" className="block text-sm font-semibold text-gray-700 mb-2">
                    คำอธิบาย
                  </label>
                  <textarea
                    id="description"
                    value={newClass.description}
                    onChange={(e) => setNewClass(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="คำอธิบายเพิ่มเติมเกี่ยวกับวิชานี้"
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                    rows={3}
                    maxLength={500}
                  />
                </div>

                <div>
                  <label htmlFor="schedule" className="block text-sm font-semibold text-gray-700 mb-2">
                    เวลาเรียน
                  </label>
                  <input
                    id="schedule"
                    type="text"
                    value={newClass.schedule}
                    onChange={(e) => setNewClass(prev => ({ ...prev, schedule: e.target.value }))}
                    placeholder="เช่น จันทร์ 9:00-12:00"
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                    maxLength={100}
                  />
                </div>
              </div>

              <div className="flex space-x-3 mt-8">
                <button
                  onClick={createClass}
                  disabled={actionLoading || !newClass.subject_name.trim()}
                  className="flex-1 bg-gradient-to-r from-blue-600 to-blue-700 text-white py-3 px-6 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                >
                  {actionLoading ? (
                    <div className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      กำลังสร้าง...
                    </div>
                  ) : (
                    '📚 สร้างคลาส'
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowCreateModal(false)
                    setNewClass({ subject_name: '', description: '', schedule: '' })
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

      {/* Start Motion Detection Session Modal */}
      {showStartSessionModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-8">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-bold text-gray-900">🎯 เริ่ม Motion Detection Session</h3>
                <button
                  onClick={() => {
                    setShowStartSessionModal(false)
                    stopCamera()
                  }}
                  className="text-gray-400 hover:text-gray-600 p-2"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-6">
                {/* Class Selection */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    เลือกคลาส *
                  </label>
                  <select
                    value={showStartSessionModal}
                    onChange={(e) => setShowStartSessionModal(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
                  >
                    <option value="">เลือกคลาส</option>
                    {classes.map((cls) => (
                      <option key={cls.class_id} value={cls.class_id}>
                        {cls.subject_name} ({cls.class_code})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Session Configuration */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      ระยะเวลาเซสชัน (ชั่วโมง)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="8"
                      value={sessionConfig.duration_hours}
                      onChange={(e) => setSessionConfig(prev => ({ ...prev, duration_hours: parseInt(e.target.value) }))}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Motion Threshold (0.01-1.0)
                    </label>
                    <input
                      type="number"
                      min="0.01"
                      max="1.0"
                      step="0.01"
                      value={sessionConfig.motion_threshold}
                      onChange={(e) => setSessionConfig(prev => ({ ...prev, motion_threshold: parseFloat(e.target.value) }))}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Cooldown (วินาที)
                    </label>
                    <input
                      type="number"
                      min="10"
                      max="300"
                      value={sessionConfig.cooldown_seconds}
                      onChange={(e) => setSessionConfig(prev => ({ ...prev, cooldown_seconds: parseInt(e.target.value) }))}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      เวลาที่ถือว่ามาทันเวลา (นาที)
                    </label>
                    <input
                      type="number"
                      min="5"
                      max="60"
                      value={sessionConfig.on_time_limit_minutes}
                      onChange={(e) => setSessionConfig(prev => ({ ...prev, on_time_limit_minutes: parseInt(e.target.value) }))}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
                    />
                  </div>
                </div>

                {/* Camera Section */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    กล้องสำหรับ Initial Capture (ไม่บังคับ)
                  </label>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
                    {!isCapturing ? (
                      <div className="text-center">
                        <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        </svg>
                        <button
                          onClick={startCamera}
                          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                        >
                          📹 เปิดกล้อง
                        </button>
                        {cameraError && (
                          <p className="text-red-600 text-sm mt-2">{cameraError}</p>
                        )}
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

                {/* Configuration Info */}
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
                  onClick={() => startMotionDetectionSession(showStartSessionModal)}
                  disabled={actionLoading || !showStartSessionModal || showStartSessionModal === true}
                  className="flex-1 bg-gradient-to-r from-green-600 to-green-700 text-white py-3 px-6 rounded-lg hover:from-green-700 hover:to-green-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                >
                  {actionLoading ? (
                    <div className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      กำลังเริ่มเซสชัน...
                    </div>
                  ) : (
                    '🎯 เริ่ม Motion Detection'
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowStartSessionModal(false)
                    stopCamera()
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

      {/* Manual Capture Modal */}
      {showManualCaptureModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full">
            <div className="p-8">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-bold text-gray-900">📸 Manual Capture</h3>
                <button
                  onClick={() => {
                    setShowManualCaptureModal(false)
                    stopCamera()
                  }}
                  className="text-gray-400 hover:text-gray-600 p-2"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {currentSession ? (
                <div className="space-y-6">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h4 className="font-medium text-blue-800 mb-2">เซสชันปัจจุบัน:</h4>
                    <p className="text-blue-700">{currentSession.classes?.subject_name} ({currentSession.classes?.class_code})</p>
                    <p className="text-blue-600 text-sm">
                      เริ่มเมื่อ: {new Date(currentSession.start_time).toLocaleString('th-TH')}
                    </p>
                  </div>

                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
                    {!isCapturing ? (
                      <div className="text-center">
                        <svg className="mx-auto h-16 w-16 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        </svg>
                        <p className="text-lg font-medium text-gray-900 mb-2">เริ่มต้น Manual Capture</p>
                        <p className="text-gray-600 mb-4">เปิดกล้องเพื่อถ่ายภาพเช็คชื่อด้วยตนเอง</p>
                        <button
                          onClick={startCamera}
                          className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
                        >
                          📹 เปิดกล้อง
                        </button>
                        {cameraError && (
                          <p className="text-red-600 text-sm mt-4">{cameraError}</p>
                        )}
                      </div>
                    ) : (
                      <div className="text-center">
                        <video
                          ref={videoRef}
                          autoPlay
                          playsInline
                          className="mx-auto rounded-lg mb-6 max-w-full h-64 object-cover border-2 border-gray-300"
                        />
                        <div className="flex justify-center space-x-4">
                          <button
                            onClick={takeManualCapture}
                            disabled={actionLoading}
                            className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 font-medium flex items-center space-x-2"
                          >
                            {actionLoading ? (
                              <>
                                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span>กำลังประมวลผล...</span>
                              </>
                            ) : (
                              <>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                </svg>
                                <span>📸 ถ่ายภาพ</span>
                              </>
                            )}
                          </button>
                          <button
                            onClick={stopCamera}
                            className="bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 transition-colors font-medium"
                          >
                            🛑 ปิดกล้อง
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <h4 className="font-medium text-yellow-800 mb-2">คำแนะนำ:</h4>
                    <ul className="text-sm text-yellow-700 space-y-1">
                      <li>• ตรวจสอบให้แน่ใจว่านักเรียนอยู่ในกรอบภาพ</li>
                      <li>• ใบหน้าควรชัดเจนและไม่มีสิ่งบดบัง</li>
                      <li>• Manual Capture จะข้าม Cooldown และ Rate Limiting</li>
                      <li>• ระบบจะประมวลผลและบันทึกการเข้าเรียนอัตโนมัติ</li>
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <svg className="mx-auto h-16 w-16 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.664-.833-2.464 0L5.35 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">ไม่พบเซสชันที่ใช้งานอยู่</h3>
                  <p className="text-gray-500">กรุณาเริ่ม Motion Detection Session ก่อนใช้ Manual Capture</p>
                </div>
              )}

              <div className="flex space-x-3 mt-8">
                <button
                  onClick={() => {
                    setShowManualCaptureModal(false)
                    stopCamera()
                  }}
                  className="flex-1 bg-gray-300 text-gray-700 py-3 px-6 rounded-lg hover:bg-gray-400 transition-colors font-semibold"
                >
                  ปิด
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Session Details Modal */}
      {showSessionDetailsModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-8">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-bold text-gray-900">📊 รายละเอียดเซสชัน</h3>
                <button
                  onClick={() => setShowSessionDetailsModal(null)}
                  className="text-gray-400 hover:text-gray-600 p-2"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-6">
                {/* Session Info */}
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-6">
                  <h4 className="text-lg font-bold text-gray-900 mb-4">ข้อมูลเซสชัน</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">คลาส</p>
                      <p className="font-medium">{showSessionDetailsModal.classes?.subject_name}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">รหัสคลาส</p>
                      <p className="font-medium">{showSessionDetailsModal.classes?.class_code}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">เริ่มเซสชัน</p>
                      <p className="font-medium">{new Date(showSessionDetailsModal.start_time).toLocaleString('th-TH')}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">จบเซสชัน</p>
                      <p className="font-medium">{showSessionDetailsModal.end_time ? new Date(showSessionDetailsModal.end_time).toLocaleString('th-TH') : 'กำลังทำงาน'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Motion Threshold</p>
                      <p className="font-medium">{showSessionDetailsModal.motion_threshold}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Cooldown</p>
                      <p className="font-medium">{showSessionDetailsModal.cooldown_seconds} วินาที</p>
                    </div>
                  </div>
                </div>

                {/* Motion Statistics */}
                {motionStats && (
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-6">
                    <h4 className="text-lg font-bold text-gray-900 mb-4">📈 สถิติ Motion Detection</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="text-center p-4 bg-white rounded-lg shadow-sm">
                        <p className="text-2xl font-bold text-green-600">{motionStats.live_stats?.motion_events || 0}</p>
                        <p className="text-sm text-gray-600">Motion Events</p>
                      </div>
                      <div className="text-center p-4 bg-white rounded-lg shadow-sm">
                        <p className="text-2xl font-bold text-blue-600">{motionStats.live_stats?.snapshots_taken || 0}</p>
                        <p className="text-sm text-gray-600">Snapshots</p>
                      </div>
                      <div className="text-center p-4 bg-white rounded-lg shadow-sm">
                        <p className="text-2xl font-bold text-purple-600">
                          {Math.round((motionStats.live_stats?.snapshot_efficiency || 0) * 100)}%
                        </p>
                        <p className="text-sm text-gray-600">Efficiency</p>
                      </div>
                      <div className="text-center p-4 bg-white rounded-lg shadow-sm">
                        <p className="text-2xl font-bold text-orange-600">{motionStats.processing?.total_queue_size || 0}</p>
                        <p className="text-sm text-gray-600">Queue Size</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Attendance Summary */}
                <div className="bg-gradient-to-r from-gray-50 to-slate-50 rounded-lg p-6">
                  <h4 className="text-lg font-bold text-gray-900 mb-4">👥 สรุปการเข้าเรียน</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-white rounded-lg shadow-sm">
                      <p className="text-xl font-bold text-green-600">
                        {attendanceRecords.filter(r => r.status === 'present').length}
                      </p>
                      <p className="text-sm text-gray-600">มาเรียน</p>
                    </div>
                    <div className="text-center p-4 bg-white rounded-lg shadow-sm">
                      <p className="text-xl font-bold text-yellow-600">
                        {attendanceRecords.filter(r => r.status === 'late').length}
                      </p>
                      <p className="text-sm text-gray-600">มาสาย</p>
                    </div>
                    <div className="text-center p-4 bg-white rounded-lg shadow-sm">
                      <p className="text-xl font-bold text-gray-600">{attendanceRecords.length}</p>
                      <p className="text-sm text-gray-600">รวมทั้งหมด</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end mt-8">
                <button
                  onClick={() => setShowSessionDetailsModal(null)}
                  className="bg-gray-300 text-gray-700 py-3 px-6 rounded-lg hover:bg-gray-400 transition-colors font-semibold"
                >
                  ปิด
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Class Code Display Modal */}
      {showClassCodeModal && (
        <ClassCodeDisplay
          classCode={showClassCodeModal.code}
          className={showClassCodeModal.name}
          onClose={() => setShowClassCodeModal(null)}
        />
      )}
    </div>
  )
}

export default EnhancedTeacherDashboard