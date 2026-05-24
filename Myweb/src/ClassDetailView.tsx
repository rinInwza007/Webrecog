import { useState, useEffect, FC } from 'react'
import { supabase } from './supabaseClient'
import type { Class, AttendanceSession, AttendanceRecord } from '@/types'
import Swal from 'sweetalert2'
import LiveVideoStream from './LiveVideoStream'

interface ClassDetailViewProps {
  classData: Class
  onBack: () => void
  currentSession: any | null
  onStartAttendance: (cls: Class) => void
  onManualCapture: (imageBlob: Blob) => Promise<void>
  motionStats: any
  onSpoofDetected: (event: SpoofEvent) => void
  attendanceRecords: any[]
  spoofEvents: SpoofEvent[]
  onShowSpoofImage: (event: SpoofEvent) => void
  onEndSession: (sessionId: string) => Promise<void>
}

interface SpoofEvent {
  image_b64: string
  timestamp: string
  spoof_count: number
}

interface AttendanceStats {
  present: number
  late: number
  absent: number
}

interface StudentAttendanceSummary {
  student_id: string
  email: string
  name: string
  user_id: string | null
  attendanceCount: number
  attendanceRate: number
}

interface ClassAttendanceData {
  sessions: AttendanceSession[]
  totalSessions: number
  totalStudents: number
  averageAttendance: number
  enrolledStudents: any[]
  recentAttendance: any[]
  attendanceByDate: Record<string, any[]>
  topStudents: StudentAttendanceSummary[]
  attendanceStats: AttendanceStats
}

const ClassDetailView: FC<ClassDetailViewProps> = ({ 
  classData, 
  onBack, 
  currentSession, 
  onStartAttendance,
  onManualCapture,
  motionStats,
  onSpoofDetected,
  attendanceRecords,
  spoofEvents,
  onShowSpoofImage,
  onEndSession
}) => {
  const [attendanceData, setAttendanceData] = useState<ClassAttendanceData>({
    sessions: [],
    totalSessions: 0,
    totalStudents: 0,
    averageAttendance: 0,
    enrolledStudents: [],
    recentAttendance: [],
    attendanceByDate: {},
    topStudents: [],
    attendanceStats: {
      present: 0,
      late: 0,
      absent: 0
    }
  })
  const [loading, setLoading] = useState(true)
  const [selectedTab, setSelectedTab] = useState('overview')
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [updateLoading, setUpdateLoading] = useState(false)
  const [dateFilter, setDateFilter] = useState('all') // 'all', 'week', 'month'
  const [statusFilter, setStatusFilter] = useState('all') // 'all', 'present', 'late', 'absent'
  const [studentFilter, setStudentFilter] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(10)

  const [realTimeUpdate, setRealTimeUpdate] = useState<{type: string, count: number} | null>(null)

  useEffect(() => {
    if (classData) {
      fetchClassAttendanceData()
      
      const interval = setInterval(() => {
        fetchClassAttendanceData(true)
      }, 30000)

      return () => clearInterval(interval)
    }
  }, [classData])

  const fetchClassAttendanceData = async (silent = false) => {
    try {
      if (!silent) setLoading(true)

      const { data: sessions, error: sessionsError } = await supabase
        .from('attendance_sessions')
        .select('*')
        .eq('class_id', classData.class_id)
        .order('start_time', { ascending: false })

      if (sessionsError) throw sessionsError

      let enrolledStudents: any[] = []

      try {
        const { data: classStudents, error: enrollError } = await supabase
          .from('v_student_class_enrollment')
          .select('student_id, student_email, student_name, school_id')
          .eq('class_id', classData.class_id)

        if (!enrollError && classStudents && classStudents.length > 0) {
          enrolledStudents = classStudents.map(cs => ({
            student_id: cs.school_id,
            email: cs.student_email,
            name: cs.student_name || 'No Name',
            user_id: cs.student_id
          }))
        }
      } catch (error) {
        console.warn('Error fetching enrolled students:', error)
      }

      if (enrolledStudents.length === 0 && sessions && sessions.length > 0) {
        const sessionIds = sessions.map(s => s.id)
        const { data: attendanceRecords } = await supabase
          .from('attendance_records')
          .select('student_id, student_email')
          .in('session_id', sessionIds)

        if (attendanceRecords) {
          const uniqueStudents = new Map()
          attendanceRecords.forEach(record => {
            if (!uniqueStudents.has(record.student_id)) {
              uniqueStudents.set(record.student_id, {
                student_id: record.student_id,
                email: record.student_email,
                name: 'Student ' + record.student_id,
                user_id: null
              })
            }
          })
          enrolledStudents = Array.from(uniqueStudents.values())
        }
      }

      const sessionIds = sessions?.map(s => s.id) || []
      let allAttendanceRecords: any[] = []
      
      if (sessionIds.length > 0) {
        const { data: attendanceRecords } = await supabase
          .from('attendance_records')
          .select(`
            *,
            attendance_sessions!inner(id, start_time, end_time, session_type, status)
          `)
          .in('session_id', sessionIds)
          .order('check_in_time', { ascending: false })

        allAttendanceRecords = attendanceRecords || []
      }

      const totalSessions = sessions?.length || 0
      const totalStudents = enrolledStudents.length
      
      const attendanceByDate: Record<string, any[]> = {}
      allAttendanceRecords.forEach(record => {
        const date = new Date(record.check_in_time).toDateString()
        if (!attendanceByDate[date]) {
          attendanceByDate[date] = []
        }
        attendanceByDate[date].push(record)
      })

      const attendanceStats = {
        present: allAttendanceRecords.filter(r => r.status === 'present').length,
        late: allAttendanceRecords.filter(r => r.status === 'late').length,
        absent: 0
      }

      let totalAttendanceRate = 0
      if (sessions && sessions.length > 0 && totalStudents > 0) {
        for (const session of sessions) {
          const sessionAttendance = allAttendanceRecords.filter(r => r.session_id === session.id)
          const attendanceRate = sessionAttendance.length / totalStudents
          totalAttendanceRate += attendanceRate
        }
        totalAttendanceRate = totalSessions > 0 ? totalAttendanceRate / totalSessions : 0
      }

      const studentAttendanceCount: Record<string, number> = {}
      allAttendanceRecords.forEach(record => {
        if (!studentAttendanceCount[record.student_id]) {
          studentAttendanceCount[record.student_id] = 0
        }
        studentAttendanceCount[record.student_id]++
      })

      const topStudents: StudentAttendanceSummary[] = enrolledStudents
        .map(student => ({
          ...student,
          attendanceCount: studentAttendanceCount[student.student_id] || 0,
          attendanceRate: totalSessions > 0 ? ((studentAttendanceCount[student.student_id] || 0) / totalSessions) * 100 : 0
        }))
        .sort((a, b) => b.attendanceCount - a.attendanceCount)

      const newData = {
        sessions: sessions || [],
        totalSessions,
        totalStudents,
        averageAttendance: totalAttendanceRate,
        enrolledStudents,
        recentAttendance: allAttendanceRecords,
        attendanceByDate,
        topStudents,
        attendanceStats
      }

      setAttendanceData(newData)

      if (!selectedSessionId && sessions && sessions.length > 0) {
        setSelectedSessionId(sessions[0].id)
      }

      if (silent && allAttendanceRecords.length > attendanceData.recentAttendance.length) {
        setRealTimeUpdate({
          type: 'new_attendance',
          count: allAttendanceRecords.length - attendanceData.recentAttendance.length
        })
        setTimeout(() => setRealTimeUpdate(null), 5000)
      }

    } catch (error) {
      console.error('Error fetching comprehensive class data:', error)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const updateAttendanceStatus = async (sessionId: string, studentEmail: string, studentId: string, newStatus: AttendanceRecord['status']) => {
    try {
      setUpdateLoading(true)
      
      // Check if record exists
      const { data: existingRecord } = await supabase
        .from('attendance_records')
        .select('id')
        .eq('session_id', sessionId)
        .eq('student_email', studentEmail)
        .maybeSingle()

      if (existingRecord) {
        const { error } = await supabase
          .from('attendance_records')
          .update({ status: newStatus })
          .eq('id', existingRecord.id)
        
        if (error) throw error
      } else {
        // Create new record (for leave/absent)
        const { error } = await supabase
          .from('attendance_records')
          .insert([{
            session_id: sessionId,
            student_email: studentEmail,
            student_id: studentId,
            status: newStatus,
            check_in_time: new Date().toISOString(),
            detection_method: 'manual',
            trigger_type: 'manual'
          }])
        
        if (error) throw error
      }

      await fetchClassAttendanceData(true)
      
      Swal.fire({
        icon: 'success',
        title: 'บันทึกสำเร็จ',
        text: `เปลี่ยนสถานะเป็น "${newStatus === 'leave' ? 'ลา' : newStatus === 'present' ? 'มาเรียน' : newStatus === 'late' ? 'มาสาย' : 'ขาด'}" เรียบร้อยแล้ว`,
        timer: 1500,
        showConfirmButton: false
      })
    } catch (error: any) {
      console.error('Error updating status:', error)
      Swal.fire({
        icon: 'error',
        title: 'เกิดข้อผิดพลาด',
        text: error.message
      })
    } finally {
      setUpdateLoading(false)
    }
  }

  const getAttendanceStatsForSession = (sessionId: string) => {
    const sessionRecords = attendanceData.recentAttendance.filter(r => r.session_id === sessionId)
    const present = sessionRecords.filter(r => r.status === 'present').length
    const late = sessionRecords.filter(r => r.status === 'late').length
    const absent = attendanceData.totalStudents - sessionRecords.length

    return { present, late, absent, total: sessionRecords.length }
  }

  const getStudentAttendanceHistory = (studentId: string) => {
    return attendanceData.recentAttendance
      .filter(r => r.student_id === studentId)
      .sort((a, b) => new Date(b.check_in_time).getTime() - new Date(a.check_in_time).getTime())
  }

  const getFilteredAttendanceRecords = () => {
    let filtered = [...attendanceData.recentAttendance]

    if (statusFilter !== 'all') {
      filtered = filtered.filter(record => record.status === statusFilter)
    }

    if (dateFilter !== 'all') {
      const now = new Date()
      const filterDate = new Date()
      
      if (dateFilter === 'week') {
        filterDate.setDate(now.getDate() - 7)
      } else if (dateFilter === 'month') {
        filterDate.setMonth(now.getMonth() - 1)
      }
      
      filtered = filtered.filter(record => 
        new Date(record.check_in_time) >= filterDate
      )
    }

    if (studentFilter) {
      filtered = filtered.filter(record => {
        const student = attendanceData.enrolledStudents.find(s => s.student_id === record.student_id)
        return student?.name.toLowerCase().includes(studentFilter.toLowerCase()) ||
               record.student_id.toLowerCase().includes(studentFilter.toLowerCase())
      })
    }

    return filtered
  }

  const getPaginatedRecords = () => {
    const filtered = getFilteredAttendanceRecords()
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return filtered.slice(startIndex, endIndex)
  }

  const getTotalPages = () => {
    return Math.ceil(getFilteredAttendanceRecords().length / itemsPerPage)
  }

  const getAttendanceTrend = () => {
    const last7Days: Record<string, number> = {}
    const now = new Date()
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)
      const dateStr = date.toDateString()
      last7Days[dateStr] = 0
    }

    attendanceData.recentAttendance.forEach(record => {
      const dateStr = new Date(record.check_in_time).toDateString()
      if (Object.prototype.hasOwnProperty.call(last7Days, dateStr)) {
        last7Days[dateStr]++
      }
    })

    return Object.entries(last7Days).map(([date, count]) => ({
      date: new Date(date).toLocaleDateString('th-TH', { month: 'short', day: 'numeric' }),
      count
    }))
  }

  const [showExportModal, setShowExportModal] = useState(false)

  const downloadCSV = (csvContent: string, prefix: string) => {
    const BOM = '\uFEFF'
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const fileName = `${prefix}_${classData.subject_name}_${new Date().toLocaleDateString('th-TH').replace(/\//g, '-')}.csv`
    link.setAttribute('href', url)
    link.setAttribute('download', fileName)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const exportSummaryToCSV = () => {
    if (attendanceData.recentAttendance.length === 0) {
    Swal.fire({
      icon: 'warning',
      title: 'ไม่มีข้อมูล',
      text: 'ไม่มีข้อมูลการเช็คชื่อ กรุณาเริ่มคาบเรียนก่อนส่งออกข้อมูล'
    })
    setShowExportModal(false)
    return
  }
    const headers = ['รหัสนักเรียน', 'ชื่อ-นามสกุล', 'อีเมล', 'คาบเรียนทั้งหมด', 'มาเรียน', 'สาย', 'ขาด', 'ร้อยละการเข้าเรียน']
    const rows = attendanceData.topStudents.map(student => {
      const studentRecords = attendanceData.recentAttendance.filter(r => r.student_id === student.student_id)
      const present = studentRecords.filter(r => r.status === 'present').length
      const late = studentRecords.filter(r => r.status === 'late').length
      const totalSessions = attendanceData.totalSessions
      const absent = totalSessions - (present + late)
      const rate = totalSessions > 0 ? ((present + late) / totalSessions * 100).toFixed(2) : '0.00'
      return [student.student_id, student.name, student.email, totalSessions, present, late, absent, `${rate}%`]
    })
    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n')
    downloadCSV(csvContent, 'summary')
    setShowExportModal(false)
  }

  const exportMatrixToCSV = () => {
    if (attendanceData.sessions.length === 0) {
    Swal.fire({
      icon: 'warning',
      title: 'ไม่มีข้อมูล',
      text: 'ไม่มีข้อมูลการเช็คชื่อ กรุณาเริ่มคาบเรียนก่อนส่งออกข้อมูล'
    })
    setShowExportModal(false)
    return
    }
    // 1. Get all sessions sorted by date
    const sortedSessions = [...attendanceData.sessions].sort((a, b) => 
      new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    )

    // 2. Prepare Headers: Student Info + Dates + Summary
    const dateHeaders = sortedSessions.map(s => 
      new Date(s.start_time).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
    )
    const headers = ['รหัสนักเรียน', 'ชื่อ-นามสกุล', ...dateHeaders, 'รวมมา/สาย', 'เปอร์เซ็นต์']

    // 3. Prepare Rows
    const rows = attendanceData.topStudents.map(student => {
      const studentRecords = attendanceData.recentAttendance.filter(r => r.student_id === student.student_id)
      
      // Get status for each session
      const attendanceStatus = sortedSessions.map(session => {
        const record = studentRecords.find(r => r.session_id === session.id)
        if (!record) return 'ขาด'
        return record.status === 'present' ? 'มา' : record.status === 'สาย' ? 'สาย' : 'ขาด'
      })

      const presentCount = studentRecords.filter(r => r.status === 'present' || r.status === 'late').length
      const percentage = sortedSessions.length > 0 ? (presentCount / sortedSessions.length * 100).toFixed(0) : '0'

      return [
        student.student_id,
        student.name,
        ...attendanceStatus,
        presentCount,
        `${percentage}%`
      ]
    })

    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n')
    downloadCSV(csvContent, 'daily_matrix')
    setShowExportModal(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">กำลังโหลดข้อมูลการเช็คชื่อ...</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-6 py-10">
        {realTimeUpdate && (
          <div className="fixed top-24 right-6 bg-[#0071e3] text-white px-6 py-3 rounded-2xl shadow-2xl z-50 animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 bg-white rounded-full animate-ping"></span>
              <span className="font-medium">มีการเช็คชื่อใหม่ {realTimeUpdate.count} รายการ!</span>
            </div>
          </div>
        )}

        {/* Header Card */}
        <div className="glass-card p-8 mb-8">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="flex items-center space-x-4">
              <button
                onClick={onBack}
                className="p-3 bg-gray-50 text-gray-400 hover:text-gray-900 hover:bg-white rounded-2xl transition-all border border-gray-100 shadow-sm"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-gray-900">📚 {classData.subject_name}</h1>
                <div className="flex items-center space-x-2 mt-1">
                  <span className="text-gray-400 text-sm font-bold uppercase tracking-wider">Class Code:</span>
                  <span className="bg-[#0071e3]/10 text-[#0071e3] px-2 py-0.5 rounded-lg text-xs font-black">{classData.class_code}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-3 w-full md:w-auto">
              {currentSession && currentSession.class_id === classData.class_id ? (
                <div className="flex-1 md:flex-none flex items-center bg-green-500/10 text-green-700 border border-green-200 px-6 py-3 rounded-2xl animate-pulse">
                  <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                  <span className="text-sm font-bold uppercase tracking-wider">กำลังเช็คชื่อ...</span>
                </div>
              ) : (
                <button
                  onClick={() => onStartAttendance(classData)}
                  className="flex-1 md:flex-none apple-button-primary py-3 px-6 flex items-center justify-center space-x-2 shadow-lg shadow-blue-500/20"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  <span>เริ่มเช็คชื่อ</span>
                </button>
              )}
              <button
                onClick={() => setShowExportModal(true)}
                className="flex-1 md:flex-none apple-button-secondary bg-green-500/10 text-green-700 border-green-200 hover:bg-green-500 hover:text-white flex items-center justify-center space-x-2 py-3 px-6"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Export Excel</span>
              </button>
              <button
                onClick={() => fetchClassAttendanceData()}
                className="flex-1 md:flex-none apple-button-secondary py-3 px-6 flex items-center justify-center space-x-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>รีเฟรช</span>
              </button>
            </div>
          </div>
        </div>

        {/* Current Session UI */}
        {currentSession && currentSession.class_id === classData.class_id && (
          <div className="space-y-6 mb-10">
            {/* Session Info Block */}
            <div className="glass-card bg-[#0071e3]/10 border-[#0071e3]/20 p-8 overflow-hidden relative">
              <div className="absolute top-0 right-0 w-64 h-64 bg-[#0071e3]/5 rounded-full blur-3xl -mr-32 -mt-32"></div>
              <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div>
                  <div className="flex items-center space-x-2 mb-2">
                    <span className="flex h-3 w-3 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                    </span>
                    <h3 className="text-sm font-bold text-[#0071e3] uppercase tracking-wider">คาบเรียนที่กำลังดำเนินการ</h3>
                  </div>
                  <h2 className="text-2xl font-semibold text-gray-900">{classData.subject_name}</h2>
                </div>
                
                <div className="flex flex-wrap gap-4">
                  <div className="flex items-center space-x-2 text-sm">
                    <span className="text-gray-400">🟢 เริ่ม:</span>
                    <span className="font-semibold text-gray-700">
                      {currentSession.start_time?.split('T')[1]?.slice(0, 5) || '-'}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 text-sm">
                    <span className="text-gray-400">⚠️ สายหลัง:</span>
                    <span className="font-semibold text-yellow-600">
                      {currentSession.start_time && currentSession.on_time_limit_minutes
                        ? new Date(new Date(currentSession.start_time).getTime() + currentSession.on_time_limit_minutes * 60000).toISOString().split('T')[1]?.slice(0, 5)
                        : '-'}
                    </span>
                  </div>
                  <button
                    onClick={() => onEndSession(currentSession.id)}
                    className="apple-button-primary bg-red-600 hover:bg-red-700 py-2.5 text-sm"
                  >
                    🛑 จบคาบเรียน
                  </button>
                </div>
              </div>

              {motionStats && (
                <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4 relative z-10">
                  <div className="bg-white/40 backdrop-blur-md rounded-2xl p-4 border border-white/60">
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-tight mb-1">Motion Events</p>
                    <p className="text-2xl font-semibold text-gray-900">{motionStats.motion_events || 0}</p>
                  </div>
                  <div className="bg-white/40 backdrop-blur-md rounded-2xl p-4 border border-white/60">
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-tight mb-1">Snapshots</p>
                    <p className="text-2xl font-semibold text-gray-900">{motionStats.snapshots_taken || 0}</p>
                  </div>
                  <div className="bg-white/40 backdrop-blur-md rounded-2xl p-4 border border-white/60">
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-tight mb-1">Efficiency</p>
                    <p className="text-2xl font-semibold text-gray-900">
                      {motionStats.snapshots_taken && motionStats.motion_events
                        ? Math.round((motionStats.snapshots_taken / motionStats.motion_events) * 100)
                        : 0}%
                    </p>
                  </div>
                  <div className="bg-white/40 backdrop-blur-md rounded-2xl p-4 border border-white/60">
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-tight mb-1">Attendance</p>
                    <p className="text-2xl font-semibold text-gray-900">{motionStats.attendance_records || 0}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Live Camera + Attendance Panel */}
            <div className="flex flex-col lg:flex-row gap-6">
              {/* Left — Camera */}
              <div className="lg:w-[70%]">
                <div className="glass-card p-2 overflow-hidden h-full">
                  <LiveVideoStream
                    currentSession={currentSession}
                    isSessionActive={true}
                    onManualCapture={onManualCapture}
                    motionStats={motionStats}
                    onSpoofDetected={onSpoofDetected}
                    onAttendanceDetected={() => {
                      console.log('✨ Attendance detected, refreshing records...')
                      fetchClassAttendanceData(true)
                    }}
                  />
                </div>
              </div>

              {/* Right — Active Session Panels */}
              <div className="lg:w-[30%] flex flex-col gap-6">
                {/* Checked-in Students Panel */}
                <div className="glass-card overflow-hidden flex-1 flex flex-col">
                  <div className="p-4 border-b border-white/40 bg-white/30 flex justify-between items-center">
                    <div className="flex items-center space-x-2">
                      <span className="flex h-2.5 w-2.5 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                      </span>
                      <h2 className="text-sm font-semibold text-gray-900">เช็คชื่อแล้ว</h2>
                    </div>
                    <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs font-bold">
                      {attendanceRecords.length} คน
                    </span>
                  </div>

                  <div className="overflow-y-auto flex-1" style={{ maxHeight: '300px' }}>
                    {attendanceRecords.length === 0 ? (
                      <div className="text-center py-8 text-gray-400">
                        <p className="text-xs font-medium">ยังไม่มีนักเรียนเช็คชื่อ</p>
                      </div>
                    ) : (
                      <div className="p-3 space-y-2">
                        {attendanceRecords.map((record, index) => (
                          <div key={record.id || index} className="flex items-center space-x-3 p-3 bg-white/50 rounded-xl border border-white/60">
                            <div className="w-8 h-8 rounded-full bg-[#0071e3]/10 flex items-center justify-center text-[#0071e3] font-bold text-xs flex-shrink-0">
                              {record.users?.full_name?.charAt(0) || '?'}
                            </div>
                            <div className="flex items-center space-x-2 w-full">
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                                record.status === 'present' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                              }`}>
                                {record.status === 'present' ? 'มา' : 'สาย'}
                              </span>
                              <span className="text-[9px] text-gray-400 shrink-0">{record.check_in_time?.split('T')[1]?.slice(0, 5)}</span>
                              
                              <div className="flex-1 flex flex-col space-y-0.5">
                                <span className="text-[9px] text-gray-400 font-medium">
                                  {record.face_match_score ? `${(record.face_match_score * 100).toFixed(0)}%` : '-'}
                                </span>
                                <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${
                                      record.face_match_score >= 0.8 ? 'bg-green-400' :
                                      record.face_match_score >= 0.6 ? 'bg-yellow-400' : 'bg-red-400'
                                    }`}
                                    style={{ width: `${(record.face_match_score || 0) * 100}%` }}
                                  />
                                </div>
                              </div>

                              <p className="text-[9px] font-semibold text-gray-700 truncate shrink-0 max-w-[60px]">
                                {record.users?.full_name || 'Unknown'}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Spoof Events Panel */}
                {spoofEvents.length > 0 && (
                  <div className="glass-card overflow-hidden">
                    <div className="p-4 border-b border-white/40 bg-red-50/30 flex justify-between items-center">
                      <div className="flex items-center space-x-2">
                        <span className="flex h-2.5 w-2.5 relative">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                        </span>
                        <h2 className="text-sm font-semibold text-gray-900">⚠️ หน้าปลอม</h2>
                      </div>
                    </div>
                    <div className="p-3 space-y-2 overflow-y-auto" style={{ maxHeight: '200px' }}>
                      {spoofEvents.map((event, index) => (
                        <div key={index} className="flex items-center justify-between p-3 bg-red-50/50 rounded-xl border border-red-100">
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-900 text-xs">ตรวจพบหน้าปลอม</p>
                            <p className="text-[10px] text-gray-400">{event.timestamp.split('T')[1]?.slice(0, 5)} · {event.spoof_count} ใบหน้า</p>
                          </div>
                          <button
                            onClick={() => onShowSpoofImage(event)}
                            className="text-[10px] px-2 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-500 hover:text-white transition-all"
                          >
                            ดูภาพ
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
          <div className="glass-card p-6 border-white/60">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">นักเรียนทั้งหมด</p>
            <p className="text-3xl font-semibold text-gray-900">{attendanceData.totalStudents}</p>
          </div>
          <div className="glass-card p-6 border-white/60">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">คาบเรียนทั้งหมด</p>
            <p className="text-3xl font-semibold text-gray-900">{attendanceData.totalSessions}</p>
          </div>
          <div className="glass-card p-6 border-[#0071e3]/20 bg-[#0071e3]/5">
            <p className="text-[10px] text-[#0071e3]/60 font-bold uppercase tracking-wider mb-1">อัตราการเข้าเรียน</p>
            <p className="text-3xl font-semibold text-[#0071e3]">{(attendanceData.averageAttendance * 100).toFixed(1)}%</p>
          </div>
          <div className="glass-card p-6 border-white/60">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">การเช็คชื่อทั้งหมด</p>
            <p className="text-3xl font-semibold text-gray-900">{attendanceData.recentAttendance.length}</p>
          </div>
        </div>

        {/* Main Tabs Container */}
        <div className="glass-card overflow-hidden">
          <div className="border-b border-white/40 bg-white/30 px-4">
            <nav className="flex space-x-1">
              {[
                {id: 'overview', label: 'ภาพรวม'}, 
                {id: 'students', label: 'นักเรียน'}, 
                {id: 'attendance', label: 'บันทึกการเช็คชื่อ'}, 
                {id: 'analytics', label: 'วิเคราะห์'},
                {id: 'sessions', label: 'คาบเรียน'}
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setSelectedTab(tab.id)}
                  className={`py-5 px-6 font-semibold text-sm transition-all relative ${
                    selectedTab === tab.id ? 'text-[#0071e3]' : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {tab.label}
                  {selectedTab === tab.id && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#0071e3] rounded-t-full shadow-[0_-2px_8px_rgba(0,113,227,0.4)]"></div>
                  )}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-8">
            {selectedTab === 'overview' && (
              <div className="space-y-8 animate-in fade-in duration-500">
                 <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-semibold tracking-tight text-gray-900">ภาพรวมคลาสเรียน</h2>
                 </div>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="glass-morphism p-8 flex flex-col h-full">
                       <h3 className="text-lg font-semibold mb-4 text-gray-900">คาบเรียนล่าสุด</h3>
                       {attendanceData.sessions.length > 0 ? (
                         <div className="space-y-4 flex-1">
                           <div className="p-4 bg-[#0071e3]/5 rounded-2xl border border-[#0071e3]/10">
                             <p className="text-xs font-bold text-[#0071e3] uppercase mb-1">คาบเรียนล่าสุดเมื่อ</p>
                             <p className="text-lg font-semibold text-gray-900">
                               {new Date(attendanceData.sessions[0].start_time).toLocaleString('th-TH', { 
                                 dateStyle: 'medium', 
                                 timeStyle: 'short' 
                               })}
                             </p>
                             <div className="mt-3 flex items-center gap-4">
                               <div>
                                 <p className="text-[10px] text-gray-400 font-bold uppercase">เช็คชื่อแล้ว</p>
                                 <p className="text-xl font-bold text-gray-900">
                                   {attendanceData.recentAttendance.filter(r => r.session_id === attendanceData.sessions[0].id).length}
                                 </p>
                               </div>
                               <div className="h-8 w-px bg-gray-200"></div>
                               <div>
                                 <p className="text-[10px] text-gray-400 font-bold uppercase">สถานะ</p>
                                 <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${
                                   attendanceData.sessions[0].status === 'active' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'
                                 }`}>
                                   {attendanceData.sessions[0].status === 'active' ? 'กำลังดำเนินการ' : 'จบแล้ว'}
                                 </span>
                               </div>
                             </div>
                           </div>
                           <p className="text-sm text-gray-500">ติดตามสถานะการเช็คชื่อล่าสุดของคุณได้ที่นี่ หรือดูรายละเอียดเพิ่มเติมในแท็บ "บันทึกการเช็คชื่อ"</p>
                         </div>
                       ) : (
                         <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
                           <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4">
                             <svg className="w-8 h-8 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                             </svg>
                           </div>
                           <p className="text-gray-400 font-medium">ยังไม่มีประวัติการเช็คชื่อ</p>
                         </div>
                       )}
                    </div>
                    <div className="glass-morphism p-8">
                       <h3 className="text-lg font-semibold mb-6 text-gray-900">สถานะการเช็คชื่อ (ทั้งหมด)</h3>
                       <div className="flex items-center justify-around h-40">
                          <div className="text-center group">
                            <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                              <p className="text-3xl font-bold text-green-500">{attendanceData.attendanceStats.present}</p>
                            </div>
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">มาเรียน</p>
                          </div>
                          <div className="text-center group">
                            <div className="w-20 h-20 bg-yellow-50 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                              <p className="text-3xl font-bold text-yellow-500">{attendanceData.attendanceStats.late}</p>
                            </div>
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">มาสาย</p>
                          </div>
                          <div className="text-center group">
                            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                              <p className="text-3xl font-bold text-red-500">
                                {attendanceData.totalSessions > 0 
                                  ? (attendanceData.totalStudents * attendanceData.totalSessions) - (attendanceData.attendanceStats.present + attendanceData.attendanceStats.late)
                                  : 0}
                              </p>
                            </div>
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">ขาดเรียน</p>
                          </div>
                       </div>
                    </div>
                 </div>
              </div>
            )}

            {selectedTab === 'students' && (
              <div className="space-y-6 animate-in fade-in duration-500">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <h2 className="text-2xl font-semibold tracking-tight text-gray-900">รายชื่อนักเรียนในคลาส</h2>
                  <div className="w-full md:w-64">
                    <input 
                      type="text"
                      placeholder="ค้นหาชื่อหรือรหัสนักเรียน..."
                      className="apple-input w-full"
                      value={studentFilter}
                      onChange={(e) => setStudentFilter(e.target.value)}
                    />
                  </div>
                </div>

                <div className="overflow-x-auto rounded-3xl border border-gray-100 bg-white/30">
                  <table className="min-w-full divide-y divide-gray-100">
                    <thead className="bg-gray-50/50">
                      <tr>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-widest">นักเรียน</th>
                        <th className="px-6 py-4 text-center text-xs font-bold text-gray-400 uppercase tracking-widest">เข้าเรียน</th>
                        <th className="px-6 py-4 text-center text-xs font-bold text-gray-400 uppercase tracking-widest">อัตราการเข้าเรียน</th>
                        <th className="px-6 py-4 text-right text-xs font-bold text-gray-400 uppercase tracking-widest">สถานะล่าสุด</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {attendanceData.topStudents
                        .filter(s => 
                          s.name.toLowerCase().includes(studentFilter.toLowerCase()) || 
                          s.student_id.toLowerCase().includes(studentFilter.toLowerCase())
                        )
                        .map((student, idx) => {
                          const lastRecord = attendanceData.recentAttendance.find(r => r.student_id === student.student_id);
                          return (
                            <tr key={idx} className="hover:bg-white/50 transition-colors group">
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                  <div className="w-10 h-10 bg-[#0071e3]/10 rounded-xl flex items-center justify-center text-[#0071e3] font-bold mr-4">
                                    {student.name.charAt(0)}
                                  </div>
                                  <div>
                                    <div className="font-semibold text-gray-900">{student.name}</div>
                                    <div className="text-xs text-gray-400">{student.student_id}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-center">
                                <span className="font-bold text-gray-900">{student.attendanceCount}</span>
                                <span className="text-gray-400 text-xs ml-1">/ {attendanceData.totalSessions}</span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex flex-col items-center">
                                  <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden mb-1">
                                    <div 
                                      className={`h-full rounded-full ${
                                        student.attendanceRate >= 80 ? 'bg-green-500' : 
                                        student.attendanceRate >= 50 ? 'bg-yellow-500' : 'bg-red-500'
                                      }`}
                                      style={{ width: `${student.attendanceRate}%` }}
                                    ></div>
                                  </div>
                                  <span className="text-xs font-bold text-gray-600">{student.attendanceRate.toFixed(0)}%</span>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-right">
                                {lastRecord ? (
                                  <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase ${
                                    lastRecord.status === 'present' ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'
                                  }`}>
                                    {lastRecord.status === 'present' ? 'มาเรียน' : 'มาสาย'}
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-bold text-gray-300 uppercase">ไม่มีข้อมูล</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            
            {selectedTab === 'attendance' && (
              <div className="space-y-6 animate-in fade-in duration-500">
                 <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-2">
                    <h2 className="text-2xl font-semibold tracking-tight">บันทึกการเช็คชื่อ</h2>
                    <div className="flex flex-wrap gap-2">
                       <input 
                         type="text"
                         placeholder="ค้นหานักเรียน..."
                         className="apple-input py-2 text-sm"
                         value={studentFilter}
                         onChange={(e) => setStudentFilter(e.target.value)}
                       />
                       <select 
                         className="apple-input py-2 text-sm appearance-none pr-8 bg-no-repeat bg-[right_0.5rem_center]"
                         value={statusFilter}
                         onChange={(e) => setStatusFilter(e.target.value)}
                       >
                          <option value="all">ทุกสถานะ</option>
                          <option value="present">มาเรียน</option>
                          <option value="late">มาสาย</option>
                       </select>
                    </div>
                 </div>
                 
                 <div className="overflow-x-auto rounded-3xl border border-gray-100 bg-white/30">
                    <table className="min-w-full divide-y divide-gray-100">
                       <thead className="bg-gray-50/50">
                          <tr>
                             <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-widest">นักเรียน</th>
                             <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-widest">เวลาเช็คชื่อ</th>
                             <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-widest">สถานะ</th>
                             <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-widest">ความแม่นยำ</th>
                          </tr>
                       </thead>
                       <tbody className="divide-y divide-gray-100">
                          {getPaginatedRecords().map((record, idx) => (
                             <tr key={idx} className="hover:bg-white/50 transition-colors group">
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <div className="font-semibold text-gray-900 group-hover:text-[#0071e3] transition-colors">{record.student_id}</div>
                                  <div className="text-xs text-gray-400">{record.student_email}</div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {new Date(record.check_in_time).toLocaleString('th-TH')}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                   <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${
                                     record.status === 'present' ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'
                                   }`}>
                                      {record.status === 'present' ? 'มาเรียน' : 'มาสาย'}
                                   </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-[#0071e3]">
                                   {record.face_match_score ? `${(record.face_match_score * 100).toFixed(0)}%` : '-'}
                                </td>
                             </tr>
                          ))}
                       </tbody>
                    </table>
                 </div>
                 
                 {getTotalPages() > 1 && (
                   <div className="flex justify-center space-x-2 mt-8">
                      <button 
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="p-2 glass-morphism disabled:opacity-30"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <span className="flex items-center px-4 font-bold text-sm text-gray-400">
                        หน้า {currentPage} จาก {getTotalPages()}
                      </span>
                      <button 
                        onClick={() => setCurrentPage(p => Math.min(getTotalPages(), p + 1))}
                        disabled={currentPage === getTotalPages()}
                        className="p-2 glass-morphism disabled:opacity-30"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                   </div>
                 )}
              </div>
            )}

            {selectedTab === 'analytics' && (
              <div className="space-y-8 animate-in fade-in duration-500">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-semibold tracking-tight text-gray-900">วิเคราะห์ข้อมูลการเข้าเรียน</h2>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Attendance Trend */}
                  <div className="lg:col-span-2 glass-morphism p-8">
                    <h3 className="text-lg font-semibold mb-6 text-gray-900">แนวโน้มการเข้าเรียน (7 วันล่าสุด)</h3>
                    <div className="h-64 flex items-end justify-between gap-2 px-4 pb-10">
                      {getAttendanceTrend().map((day, idx) => (
                        <div key={idx} className="flex-1 flex flex-col items-center group relative h-full">
                          <div className="flex-1 w-full flex flex-col justify-end items-center">
                            <div 
                              className="w-full max-w-[40px] bg-[#0071e3] rounded-t-xl transition-all group-hover:bg-[#0071e3]/80 relative"
                              style={{ height: `${(day.count / (attendanceData.totalStudents || 1)) * 100}%`, minHeight: '4px' }}
                            >
                              <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                                {day.count} คน
                              </div>
                            </div>
                          </div>
                          <div className="absolute -bottom-6 left-1/2 -translate-x-1/2">
                            <p className="text-[10px] font-bold text-gray-400 rotate-45 origin-left whitespace-nowrap">{day.date}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Distribution */}
                  <div className="glass-morphism p-8">
                    <h3 className="text-lg font-semibold mb-6 text-gray-900">สัดส่วนการมาเรียน</h3>
                    <div className="space-y-6">
                      {[
                        { label: 'มาตรงเวลา', count: attendanceData.attendanceStats.present, color: 'bg-green-500', total: attendanceData.recentAttendance.length },
                        { label: 'มาสาย', count: attendanceData.attendanceStats.late, color: 'bg-yellow-500', total: attendanceData.recentAttendance.length }
                      ].map((item, idx) => (
                        <div key={idx}>
                          <div className="flex justify-between text-sm mb-2">
                            <span className="font-medium text-gray-600">{item.label}</span>
                            <span className="font-bold text-gray-900">{item.total > 0 ? ((item.count / item.total) * 100).toFixed(1) : 0}%</span>
                          </div>
                          <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full ${item.color}`} style={{ width: `${item.total > 0 ? (item.count / item.total) * 100 : 0}%` }}></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Top Students */}
                  <div className="glass-morphism p-8">
                    <h3 className="text-lg font-semibold mb-6 text-gray-900">นักเรียนที่เข้าเรียนสม่ำเสมอ</h3>
                    <div className="space-y-4">
                      {attendanceData.topStudents.slice(0, 5).map((student, idx) => (
                        <div key={idx} className="flex items-center justify-between p-4 bg-white/50 rounded-2xl border border-gray-100">
                          <div className="flex items-center">
                            <div className="w-8 h-8 bg-green-100 text-green-600 rounded-lg flex items-center justify-center font-bold mr-3 text-xs">
                              {idx + 1}
                            </div>
                            <span className="font-semibold text-gray-900">{student.name}</span>
                          </div>
                          <span className="text-sm font-bold text-[#0071e3]">{student.attendanceRate.toFixed(0)}%</span>
                        </div>
                      ))}
                      {attendanceData.topStudents.length === 0 && (
                        <p className="text-center py-10 text-gray-400 font-medium italic">ยังไม่มีข้อมูลนักเรียน</p>
                      )}
                    </div>
                  </div>

                  {/* Low Attendance Students */}
                  <div className="glass-morphism p-8">
                    <h3 className="text-lg font-semibold mb-6 text-gray-900">นักเรียนที่เสี่ยงต่อการขาดเรียน</h3>
                    <div className="space-y-4">
                      {attendanceData.topStudents
                        .filter(s => s.attendanceRate < 50 && s.attendanceCount < attendanceData.totalSessions / 2)
                        .slice(0, 5)
                        .map((student, idx) => (
                          <div key={idx} className="flex items-center justify-between p-4 bg-red-50/30 rounded-2xl border border-red-100">
                            <div className="flex items-center">
                              <div className="w-8 h-8 bg-red-100 text-red-600 rounded-lg flex items-center justify-center font-bold mr-3 text-xs">
                                !
                              </div>
                              <span className="font-semibold text-gray-900">{student.name}</span>
                            </div>
                            <span className="text-sm font-bold text-red-500">{student.attendanceRate.toFixed(0)}%</span>
                          </div>
                        ))}
                      {attendanceData.topStudents.filter(s => s.attendanceRate < 50 && s.attendanceCount < attendanceData.totalSessions / 2).length === 0 && (
                        <p className="text-center py-10 text-gray-400 font-medium italic">ไม่มีนักเรียนที่มีอัตราการเข้าเรียนต่ำกว่าเกณฑ์</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {selectedTab === 'sessions' && (
              <div className="space-y-8 animate-in fade-in duration-500">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-gray-900">จัดการรายคาบเรียน</h2>
                    <p className="text-gray-500 text-sm mt-1">ดูรายละเอียดและแก้ไขสถานะการเช็คชื่อรายคาบ</p>
                  </div>
                  
                  {/* Session Selector */}
                  <div className="w-full md:w-72">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">เลือกคาบเรียน</label>
                    <select 
                      className="apple-input w-full py-3 pr-10 appearance-none bg-no-repeat bg-[right_1rem_center]"
                      value={selectedSessionId || ''}
                      onChange={(e) => setSelectedSessionId(e.target.value)}
                    >
                      {attendanceData.sessions.map((session, idx) => (
                        <option key={session.id} value={session.id}>
                          คาบที่ {attendanceData.sessions.length - idx}: {new Date(session.start_time).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {selectedSessionId ? (
                  <div className="space-y-6">
                    {/* Session Summary Card */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      {(() => {
                        const stats = getAttendanceStatsForSession(selectedSessionId)
                        return (
                          <>
                            <div className="glass-morphism p-4 border-green-100 bg-green-50/30">
                              <p className="text-[10px] text-green-600 font-bold uppercase mb-1">มาเรียน</p>
                              <p className="text-2xl font-bold text-green-700">{stats.present}</p>
                            </div>
                            <div className="glass-morphism p-4 border-yellow-100 bg-yellow-50/30">
                              <p className="text-[10px] text-yellow-600 font-bold uppercase mb-1">มาสาย</p>
                              <p className="text-2xl font-bold text-yellow-700">{stats.late}</p>
                            </div>
                            <div className="glass-morphism p-4 border-red-100 bg-red-50/30">
                              <p className="text-[10px] text-red-600 font-bold uppercase mb-1">ขาดเรียน</p>
                              <p className="text-2xl font-bold text-red-700">{stats.absent}</p>
                            </div>
                            <div className="glass-morphism p-4 border-blue-100 bg-blue-50/30">
                              <p className="text-[10px] text-blue-600 font-bold uppercase mb-1">ทั้งหมด</p>
                              <p className="text-2xl font-bold text-blue-700">{attendanceData.totalStudents}</p>
                            </div>
                          </>
                        )
                      })()}
                    </div>

                    {/* Attendance Table for Selected Session */}
                    <div className="overflow-x-auto rounded-3xl border border-gray-100 bg-white/30">
                      <table className="min-w-full divide-y divide-gray-100">
                        <thead className="bg-gray-50/50">
                          <tr>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-widest">นักเรียน</th>
                            <th className="px-6 py-4 text-center text-xs font-bold text-gray-400 uppercase tracking-widest">เวลาเช็คชื่อ</th>
                            <th className="px-6 py-4 text-center text-xs font-bold text-gray-400 uppercase tracking-widest">สถานะ</th>
                            <th className="px-6 py-4 text-right text-xs font-bold text-gray-400 uppercase tracking-widest">จัดการ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {attendanceData.enrolledStudents.map((student, idx) => {
                            const record = attendanceData.recentAttendance.find(
                              r => r.session_id === selectedSessionId && r.student_id === student.student_id
                            )
                            const status = record ? record.status : 'absent'
                            
                            return (
                              <tr key={idx} className="hover:bg-white/50 transition-colors">
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <div className="font-semibold text-gray-900">{student.name}</div>
                                  <div className="text-xs text-gray-400">{student.student_id}</div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">
                                  {record ? new Date(record.check_in_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-center">
                                  <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${
                                    status === 'present' ? 'bg-green-100 text-green-600' : 
                                    status === 'late' ? 'bg-yellow-100 text-yellow-600' : 
                                    status === 'leave' ? 'bg-blue-100 text-blue-600' : 'bg-red-100 text-red-600'
                                  }`}>
                                    {status === 'present' ? 'มาเรียน' : 
                                     status === 'late' ? 'มาสาย' : 
                                     status === 'leave' ? 'ลา' : 'ขาดเรียน'}
                                  </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right">
                                  <div className="flex justify-end space-x-2">
                                    {status === 'absent' ? (
                                      <button 
                                        onClick={() => updateAttendanceStatus(selectedSessionId, student.email, student.student_id, 'leave')}
                                        disabled={updateLoading}
                                        className="text-[10px] font-bold text-[#0071e3] hover:underline disabled:opacity-30"
                                      >
                                        เปลี่ยนเป็น "ลา"
                                      </button>
                                    ) : status === 'leave' ? (
                                      <button 
                                        onClick={() => updateAttendanceStatus(selectedSessionId, student.email, student.student_id, 'absent')}
                                        disabled={updateLoading}
                                        className="text-[10px] font-bold text-red-500 hover:underline disabled:opacity-30"
                                      >
                                        เปลี่ยนเป็น "ขาด"
                                      </button>
                                    ) : (
                                      <span className="text-[10px] text-gray-300">แก้ไขไม่ได้</span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-20 bg-gray-50/50 rounded-3xl border border-dashed border-gray-200">
                    <p className="text-gray-400">กรุณาเลือกคาบเรียนเพื่อดูข้อมูล</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowExportModal(false)}></div>
          <div className="max-w-lg w-full glass-card overflow-hidden relative z-10 shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="p-8">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h3 className="text-2xl font-semibold tracking-tight text-gray-900">ส่งออกข้อมูล</h3>
                  <p className="text-gray-500 text-sm font-medium">เลือกรูปแบบรายงานที่ต้องการดาวน์โหลด</p>
                </div>
                <button
                  onClick={() => setShowExportModal(false)}
                  className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-xl transition-all"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <button
                  onClick={exportSummaryToCSV}
                  className="group flex items-center p-6 glass-morphism hover:bg-[#0071e3] hover:border-[#0071e3] transition-all text-left"
                >
                  <div className="w-14 h-14 bg-[#0071e3]/10 group-hover:bg-white rounded-2xl flex items-center justify-center mr-6 transition-all">
                    <svg className="w-8 h-8 text-[#0071e3] group-hover:text-[#0071e3]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900 group-hover:text-white transition-colors">รายงานสรุปผลรายวิชา</h4>
                    <p className="text-sm text-gray-400 group-hover:text-white/80 transition-colors">สรุปจำนวนครั้งที่ มา/สาย/ขาด รายบุคคล</p>
                  </div>
                </button>

                <button
                  onClick={exportMatrixToCSV}
                  className="group flex items-center p-6 glass-morphism hover:bg-green-600 hover:border-green-600 transition-all text-left"
                >
                  <div className="w-14 h-14 bg-green-50 group-hover:bg-white rounded-2xl flex items-center justify-center mr-6 transition-all">
                    <svg className="w-8 h-8 text-green-600 group-hover:text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900 group-hover:text-white transition-colors">รายงานเช็คชื่อรายวัน</h4>
                    <p className="text-sm text-gray-400 group-hover:text-white/80 transition-colors">ตารางแสดงสถานะแยกตามวันที่ครบถ้วน</p>
                  </div>
                </button>
              </div>

              <div className="mt-8 p-4 bg-gray-50/50 rounded-2xl border border-gray-100">
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest text-center">ไฟล์ที่ได้รับจะเป็นรูปแบบ .csv (Excel) รองรับภาษาไทย</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ClassDetailView
