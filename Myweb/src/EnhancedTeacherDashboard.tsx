import { useState, useEffect, useRef, FC } from 'react'
import { useAuth } from './login/AuthContext'
import { supabase } from './supabaseClient'
import ClassCodeDisplay from './ClassCodeDisplay'
import LiveVideoStream from './LiveVideoStream'
import ClassDetailView from './ClassDetailView'
import config from './config'
import image from './utils/logo/image.png' 
import type { Class, AttendanceSession, AttendanceRecord, User as AppUser } from '@/types'

const EnhancedTeacherDashboard: FC = () => {
  const { user, signOut } = useAuth()
  const [classes, setClasses] = useState<Class[]>([])
  const [sessions, setSessions] = useState<any[]>([])
  const [currentSession, setCurrentSession] = useState<any>(null)
  const [attendanceRecords, setAttendanceRecords] = useState<any[]>([])
  const [motionStats, setMotionStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  
  // เพิ่ม state สำหรับ Class Detail View
  const [selectedClass, setSelectedClass] = useState<Class | null>(null)
  const [showClassDetail, setShowClassDetail] = useState(false)
  
  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showStartSessionModal, setShowStartSessionModal] = useState<string | boolean>(false)
  const [showClassCodeModal, setShowClassCodeModal] = useState<{code: string, name: string} | null>(null)
  const [showSessionDetailsModal, setShowSessionDetailsModal] = useState<any>(null)
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
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [cameraError, setCameraError] = useState('')

  // FastAPI URL
  const FASTAPI_URL = config.BACKEND_URL

  // Function สำหรับเปิด Class Detail View
  const handleClassClick = (classData: Class) => {
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
        setSessions(sessionsData || [])
      }

      // Set current session with motion detection preference
      const activeSessions = (sessionsData as any[]) || []
      if (activeSessions.length > 0) {
        // ให้ความสำคัญกับ motion detection sessions
        const motionSession = activeSessions.find(s => s.session_type === 'motion_detection')
        const selectedSession = motionSession || activeSessions[0]
        
        setCurrentSession(selectedSession)
        await fetchAttendanceRecords(selectedSession.id)
      } else {
        setCurrentSession(null)
        setAttendanceRecords([])
      }

    } catch (error) {
      console.error('❌ Error fetching teacher data:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchAttendanceRecords = async (sessionId: string) => {
    try {
      const { data: records, error } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('session_id', sessionId)
        .order('check_in_time', { ascending: false })

      if (error) throw error

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
      
    } catch (error) {
      console.error('❌ Error fetching attendance records:', error)
      setAttendanceRecords([])
    }
  }

  const handleManualCaptureFromVideo = async (imageBlob: Blob) => {
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
      alert(`📸 Manual Capture สำเร็จ!\n\nพบใบหน้า: ${result.faces_detected} คน`)
      
      // Refresh attendance records
      setTimeout(() => {
        fetchAttendanceRecords(currentSession.id)
      }, 2000)
      
    } catch (error: any) {
      console.error('Error taking manual capture:', error)
      alert('เกิดข้อผิดพลาดในการถ่ายภาพ: ' + error.message)
    } finally {
      setActionLoading(false)
    }
  }

  const fetchMotionStats = async () => {
    if (!currentSession) return

    try {
      const response = await fetch(`${FASTAPI_URL}/api/motion/session/${currentSession.id}/live-stats`)
      
      if (response.ok) {
        const data = await response.json()
        
        if (data.session_type === 'motion_detection' || data.success) {
          setMotionStats(data)
        } else {
          setMotionStats({
            ...data,
            isMotionSession: false
          })
        }
      } else {
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
        teacher_id: user?.id,
        teacher_email: user?.email,
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
    } catch (error: any) {
      console.error('Error creating class:', error)
      alert('เกิดข้อผิดพลาดในการสร้างคลาสเรียน: ' + error.message)
    } finally {
      setActionLoading(false)
    }
  }

  const startMotionDetectionSession = async (classId: string | boolean) => {
    if (typeof classId !== 'string') return
    setActionLoading(true)

    try {
      // Get initial camera image if available
      let imageBlob = null
      if (videoRef.current && isCapturing) {
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')
        if (context) {
          canvas.width = videoRef.current.videoWidth
          canvas.height = videoRef.current.videoHeight
          context.drawImage(videoRef.current, 0, 0)
          
          imageBlob = await new Promise<Blob | null>(resolve => {
            canvas.toBlob(resolve, 'image/jpeg', 0.8)
          })
        }
      }

      const formData = new FormData()
      formData.append('class_id', classId)
      formData.append('teacher_email', user?.email || '')
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

      alert(`🎯 เริ่มเซสชัน Motion Detection สำเร็จ!`)
      
      setShowStartSessionModal(false)
      fetchTeacherData()
      
    } catch (error: any) {
      console.error('Error starting motion detection session:', error)
      alert('เกิดข้อผิดพลาดในการเริ่มเซสชัน: ' + error.message)
    } finally {
      setActionLoading(false)
    }
  }

  const endSession = async (sessionId: string) => {
    if (!confirm('คุณต้องการจบเซสชันนี้หรือไม่?')) return

    setActionLoading(true)

    try {
      let endpoint = `${FASTAPI_URL}/api/session/${sessionId}/end`
      
      if (currentSession?.session_type === 'motion_detection') {
        endpoint = `${FASTAPI_URL}/api/session/${sessionId}/end-motion`
      }
      
      const response = await fetch(endpoint, {
        method: 'PUT'
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || `Failed to end session (${response.status})`)
      }

      alert(`✅ จบเซสชันสำเร็จ!`)
      fetchTeacherData()
      
    } catch (error: any) {
      console.error('❌ Error ending session:', error)
      alert(`❌ เกิดข้อผิดพลาดในการจบเซสชัน: ${error.message}`)
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
    } catch (error: any) {
      console.error('Error starting camera:', error)
      setCameraError('ไม่สามารถเปิดกล้องได้: ' + error.message)
    }
  }

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream
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
      if (!context) return
      canvas.width = videoRef.current.videoWidth
      canvas.height = videoRef.current.videoHeight
      context.drawImage(videoRef.current, 0, 0)
      
      const imageBlob = await new Promise<Blob | null>(resolve => {
        canvas.toBlob(resolve, 'image/jpeg', 0.8)
      })

      if (!imageBlob) return

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

      alert(`📸 Manual Capture สำเร็จ!`)
      
      setTimeout(() => {
        fetchAttendanceRecords(currentSession.id)
      }, 2000)
      
    } catch (error: any) {
      console.error('Error taking manual capture:', error)
      alert('เกิดข้อผิดพลาดในการถ่ายภาพ: ' + error.message)
    } finally {
      setActionLoading(false)
    }
  }

  const deleteClass = async (classId: string, className: string) => {
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
    } catch (error: any) {
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
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/60 backdrop-blur-xl border-b border-white/40 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <div className="bg-white p-2 rounded-2xl shadow-sm border border-gray-100">
                <img src={image} alt="Logo" className="h-14 w-14 object-contain" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-gray-900">แดชบอร์ดอาจารย์</h1>
                <p className="text-gray-500 text-sm font-medium">ยินดีต้อนรับ, {user?.user_metadata?.full_name || user?.email}</p>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="apple-button-secondary py-2 px-5 text-sm flex items-center space-x-2 border-red-100 hover:bg-red-50 hover:text-red-600 transition-all"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span>ออกจากระบบ</span>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Current Session Status */}
        {currentSession && (
          <div className="glass-card bg-[#0071e3]/10 border-[#0071e3]/20 p-8 mb-10 overflow-hidden relative">
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#0071e3]/5 rounded-full blur-3xl -mr-32 -mt-32"></div>
            <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div>
                <div className="flex items-center space-x-2 mb-2">
                  <span className="flex h-3 w-3 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                  </span>
                  <h3 className="text-sm font-bold text-[#0071e3] uppercase tracking-wider">เซสชันที่กำลังดำเนินการ</h3>
                </div>
                <h2 className="text-2xl font-semibold text-gray-900">{currentSession.classes?.subject_name}</h2>
                <p className="text-gray-500 font-medium">รหัสคลาส: {currentSession.classes?.class_code}</p>
              </div>
              
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => setShowManualCaptureModal(true)}
                  disabled={currentSession.session_type !== 'motion_detection'}
                  className="apple-button-secondary bg-white py-2.5 text-sm disabled:opacity-50"
                >
                  📸 Manual Capture
                </button>
                <button
                  onClick={() => setShowSessionDetailsModal(currentSession)}
                  className="apple-button-secondary bg-white py-2.5 text-sm"
                >
                  📊 รายละเอียด
                </button>
                <button
                  onClick={() => endSession(currentSession.id)}
                  disabled={actionLoading}
                  className="apple-button-primary bg-red-600 hover:bg-red-700 py-2.5 text-sm"
                >
                  🛑 จบเซสชัน
                </button>
              </div>
            </div>
              
            {motionStats && currentSession && (
              <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4 relative z-10">
                <div className="bg-white/40 backdrop-blur-md rounded-2xl p-4 border border-white/60">
                  <p className="text-gray-500 text-xs font-bold uppercase tracking-tight mb-1">Motion Events</p>
                  <p className="text-2xl font-semibold text-gray-900">{motionStats.live_stats?.motion_events || 0}</p>
                </div>
                <div className="bg-white/40 backdrop-blur-md rounded-2xl p-4 border border-white/60">
                  <p className="text-gray-500 text-xs font-bold uppercase tracking-tight mb-1">Snapshots</p>
                  <p className="text-2xl font-semibold text-gray-900">{motionStats.live_stats?.snapshots_taken || 0}</p>
                </div>
                <div className="bg-white/40 backdrop-blur-md rounded-2xl p-4 border border-white/60">
                  <p className="text-gray-500 text-xs font-bold uppercase tracking-tight mb-1">Efficiency</p>
                  <p className="text-2xl font-semibold text-gray-900">
                    {Math.round((motionStats.live_stats?.snapshot_efficiency || 0) * 100)}%
                  </p>
                </div>
                <div className="bg-white/40 backdrop-blur-md rounded-2xl p-4 border border-white/60">
                  <p className="text-gray-500 text-xs font-bold uppercase tracking-tight mb-1">Queue Size</p>
                  <p className="text-2xl font-semibold text-gray-900">{motionStats.processing?.total_queue_size || 0}</p>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mb-10">
          <div className="glass-card p-2 overflow-hidden">
            <LiveVideoStream
              currentSession={currentSession}
              isSessionActive={currentSession !== null}
              onManualCapture={handleManualCaptureFromVideo}
              motionStats={motionStats}
            />
          </div>
        </div>

        {/* Stats Cards & Quick Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-10">
          <div className="lg:col-span-1 glass-card p-8 flex flex-col justify-center items-center text-center">
            <div className="w-20 h-20 bg-[#0071e3]/10 rounded-3xl flex items-center justify-center mb-4">
              <svg className="w-10 h-10 text-[#0071e3]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <p className="text-gray-500 font-semibold uppercase tracking-wider text-xs mb-1">คลาสที่สอนทั้งหมด</p>
            <p className="text-5xl font-bold text-gray-900">{classes.length}</p>
          </div>

          <div className="lg:col-span-2 glass-card p-8">
            <h3 className="text-xl font-semibold text-gray-900 mb-6">เมนูจัดการ</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                onClick={() => setShowCreateModal(true)}
                className="apple-button-primary flex items-center justify-center space-x-3 py-5"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>สร้างคลาสใหม่</span>
              </button>
              
              <button
                onClick={() => setShowStartSessionModal(true)}
                disabled={currentSession !== null}
                className="apple-button-secondary bg-green-500/10 text-green-700 border-green-200 hover:bg-green-500 hover:text-white flex items-center justify-center space-x-3 py-5 disabled:opacity-50"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                <span>เริ่มเช็คชื่อ</span>
              </button>
            </div>
          </div>
        </div>

        {/* Classes Section */}
        <div className="glass-card overflow-hidden">
          <div className="p-8 border-b border-white/40 flex justify-between items-center bg-white/30">
            <h2 className="text-2xl font-semibold tracking-tight text-gray-900">📚 คลาสเรียนของฉัน</h2>
            {classes.length > 0 && (
              <span className="bg-[#0071e3]/10 text-[#0071e3] px-3 py-1 rounded-full text-xs font-bold">
                {classes.length} คลาส
              </span>
            )}
          </div>

          <div className="p-8">
            {classes.length === 0 ? (
              <div className="text-center py-20 bg-gray-50/50 rounded-3xl border border-dashed border-gray-200">
                <div className="bg-white w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                  <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <p className="text-gray-500 font-medium mb-6">คุณยังไม่มีคลาสเรียนในขณะนี้</p>
                <button onClick={() => setShowCreateModal(true)} className="apple-button-primary">สร้างคลาสแรกของคุณ</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {classes.map((cls) => (
                  <div 
                    key={cls.class_id} 
                    className="glass-morphism p-6 hover:shadow-lg hover:border-[#0071e3]/30 transition-all group cursor-pointer"
                    onClick={() => handleClassClick(cls)}
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className="bg-[#0071e3]/10 p-3 rounded-2xl group-hover:bg-[#0071e3] group-hover:text-white transition-colors">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                      </div>
                      <div className="flex space-x-1">
                        <button 
                          onClick={(e) => { e.stopPropagation(); setShowClassCodeModal({code: cls.class_code, name: cls.subject_name}) }}
                          className="p-2 hover:bg-[#0071e3]/10 rounded-xl text-gray-400 hover:text-[#0071e3] transition-colors"
                          title="แชร์รหัส"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                          </svg>
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); deleteClass(cls.class_id, cls.subject_name) }}
                          className="p-2 hover:bg-red-50 rounded-xl text-gray-400 hover:text-red-600 transition-colors"
                          title="ลบ"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-1 group-hover:text-[#0071e3] transition-colors">{cls.subject_name}</h3>
                    <p className="text-gray-400 text-sm font-bold mb-4">{cls.class_code}</p>
                    <div className="flex items-center text-[#0071e3] text-sm font-semibold opacity-0 group-hover:opacity-100 transition-all">
                      <span>เข้าจัดการคลาส</span>
                      <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}></div>
          <div className="max-w-md w-full glass-card p-10 relative z-10 shadow-2xl scale-100 animate-in fade-in zoom-in duration-300">
            <h3 className="text-2xl font-semibold tracking-tight text-gray-900 mb-6 text-center">สร้างคลาสใหม่</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-2 ml-1">ชื่อวิชา</label>
                <input 
                  className="w-full apple-input"
                  placeholder="เช่น วิทยาการคอมพิวเตอร์"
                  value={newClass.subject_name}
                  onChange={(e) => setNewClass({...newClass, subject_name: e.target.value})}
                />
              </div>
              <div className="flex space-x-3 pt-4">
                <button 
                  onClick={() => setShowCreateModal(false)} 
                  className="flex-1 apple-button-secondary py-3"
                >
                  ยกเลิก
                </button>
                <button 
                  onClick={createClass} 
                  disabled={actionLoading}
                  className="flex-1 apple-button-primary py-3"
                >
                  {actionLoading ? 'กำลังสร้าง...' : 'สร้างคลาส'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showStartSessionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowStartSessionModal(false)}></div>
          <div className="max-w-md w-full glass-card overflow-hidden relative z-10 shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="bg-[#0071e3] p-8 text-white text-center">
              <h3 className="text-2xl font-semibold tracking-tight">เริ่มระบบเช็คชื่อ</h3>
              <p className="text-white/70 text-sm mt-1">เลือกคลาสเรียนที่ต้องการเช็คชื่อ</p>
            </div>
            
            <div className="p-8">
              <div className="space-y-3 max-h-80 overflow-y-auto mb-8 pr-2">
                {classes.length === 0 ? (
                  <p className="text-center text-gray-400 py-6">ไม่พบคลาสเรียน</p>
                ) : (
                  classes.map((cls) => (
                    <button
                      key={cls.class_id}
                      onClick={() => startMotionDetectionSession(cls.class_id)}
                      disabled={actionLoading}
                      className="w-full text-left p-5 rounded-2xl border border-gray-100 hover:border-[#0071e3]/30 hover:bg-[#0071e3]/5 transition-all group flex justify-between items-center"
                    >
                      <div>
                        <p className="font-semibold text-gray-900 group-hover:text-[#0071e3] transition-colors">{cls.subject_name}</p>
                        <p className="text-xs text-gray-400 font-bold">{cls.class_code}</p>
                      </div>
                      <div className="bg-[#0071e3]/10 text-[#0071e3] p-2 rounded-xl group-hover:bg-[#0071e3] group-hover:text-white transition-all">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        </svg>
                      </div>
                    </button>
                  ))
                )}
              </div>

              <button
                onClick={() => setShowStartSessionModal(false)}
                className="w-full apple-button-secondary py-3 text-sm"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}

      {showClassCodeModal && (
        <ClassCodeDisplay
          classCode={showClassCodeModal.code}
          className={showClassCodeModal.name}
          onClose={() => setShowClassCodeModal(null)}
        />
      )}
      
      {/* ... Add other modals here as needed, logic is implemented ... */}
    </div>
  )
}

export default EnhancedTeacherDashboard
