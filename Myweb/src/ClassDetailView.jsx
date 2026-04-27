import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

const ClassDetailView = ({ classData, onBack }) => {
  const [attendanceData, setAttendanceData] = useState({
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
  const [dateFilter, setDateFilter] = useState('all') // 'all', 'week', 'month'
  const [statusFilter, setStatusFilter] = useState('all') // 'all', 'present', 'late', 'absent'
  const [studentFilter, setStudentFilter] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(10)

  // Real-time updates
  const [realTimeUpdate, setRealTimeUpdate] = useState(null)

  useEffect(() => {
    if (classData) {
      fetchClassAttendanceData()
      
      // Set up real-time updates every 30 seconds
      const interval = setInterval(() => {
        fetchClassAttendanceData(true) // silent update
      }, 30000)

      return () => clearInterval(interval)
    }
  }, [classData])

  const fetchClassAttendanceData = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      console.log('🔍 Fetching comprehensive attendance data for class:', classData.class_id)

      // Fetch all sessions for this class
      const { data: sessions, error: sessionsError } = await supabase
        .from('attendance_sessions')
        .select('*')
        .eq('class_id', classData.class_id)
        .order('start_time', { ascending: false })

      if (sessionsError) {
        console.error('Error fetching sessions:', sessionsError)
        return
      }

      // Fetch enrolled students
      let enrolledStudents = []
      
      try {
        const { data: classStudents } = await supabase
          .from('class_students')
          .select(`
            user_id,
            users!inner(id, school_id, email, full_name)
          `)
          .eq('class_id', classData.class_id)

        if (classStudents && classStudents.length > 0) {
          enrolledStudents = classStudents.map(cs => ({
            student_id: cs.users.school_id,
            email: cs.users.email,
            name: cs.users.full_name || 'No Name',
            user_id: cs.users.id
          }))
        }
      } catch (error) {
        console.warn('class_students table not available:', error)
      }

      // If no enrolled students found, infer from attendance records
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

      // Fetch all attendance records with enhanced data
      const sessionIds = sessions?.map(s => s.id) || []
      let allAttendanceRecords = []
      
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

      // Calculate comprehensive statistics
      const totalSessions = sessions?.length || 0
      const totalStudents = enrolledStudents.length
      
      // Group attendance by date for analysis
      const attendanceByDate = {}
      allAttendanceRecords.forEach(record => {
        const date = new Date(record.check_in_time).toDateString()
        if (!attendanceByDate[date]) {
          attendanceByDate[date] = []
        }
        attendanceByDate[date].push(record)
      })

      // Calculate overall attendance stats
      const attendanceStats = {
        present: allAttendanceRecords.filter(r => r.status === 'present').length,
        late: allAttendanceRecords.filter(r => r.status === 'late').length,
        absent: 0 // This would need to be calculated based on expected vs actual attendance
      }

      // Calculate average attendance rate
      let totalAttendanceRate = 0
      if (sessions && sessions.length > 0 && totalStudents > 0) {
        for (const session of sessions) {
          const sessionAttendance = allAttendanceRecords.filter(r => r.session_id === session.id)
          const attendanceRate = sessionAttendance.length / totalStudents
          totalAttendanceRate += attendanceRate
        }
        totalAttendanceRate = totalSessions > 0 ? totalAttendanceRate / totalSessions : 0
      }

      // Calculate top students (by attendance frequency)
      const studentAttendanceCount = {}
      allAttendanceRecords.forEach(record => {
        if (!studentAttendanceCount[record.student_id]) {
          studentAttendanceCount[record.student_id] = 0
        }
        studentAttendanceCount[record.student_id]++
      })

      const topStudents = enrolledStudents
        .map(student => ({
          ...student,
          attendanceCount: studentAttendanceCount[student.student_id] || 0,
          attendanceRate: totalSessions > 0 ? ((studentAttendanceCount[student.student_id] || 0) / totalSessions) * 100 : 0
        }))
        .sort((a, b) => b.attendanceCount - a.attendanceCount)

      console.log('📊 Comprehensive attendance data loaded:', {
        totalSessions,
        totalStudents,
        totalRecords: allAttendanceRecords.length,
        averageAttendance: totalAttendanceRate,
        topStudents: topStudents.slice(0, 5).map(s => `${s.name}: ${s.attendanceCount}`)
      })

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

      // Show real-time update notification if this is a silent update
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

  const getAttendanceStatsForSession = (sessionId) => {
    const sessionRecords = attendanceData.recentAttendance.filter(r => r.session_id === sessionId)
    const present = sessionRecords.filter(r => r.status === 'present').length
    const late = sessionRecords.filter(r => r.status === 'late').length
    const absent = attendanceData.totalStudents - sessionRecords.length

    return { present, late, absent, total: sessionRecords.length }
  }

  const getStudentAttendanceHistory = (studentId) => {
    return attendanceData.recentAttendance
      .filter(r => r.student_id === studentId)
      .sort((a, b) => new Date(b.check_in_time) - new Date(a.check_in_time))
  }

  const getFilteredAttendanceRecords = () => {
    let filtered = [...attendanceData.recentAttendance]

    // Filter by status
    if (statusFilter !== 'all') {
      filtered = filtered.filter(record => record.status === statusFilter)
    }

    // Filter by date range
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

    // Filter by student
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
    const last7Days = {}
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Real-time Update Notification */}
        {realTimeUpdate && (
          <div className="fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-bounce">
            <div className="flex items-center space-x-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>มีการเช็คชื่อใหม่ {realTimeUpdate.count} รายการ!</span>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={onBack}
                className="flex items-center text-gray-600 hover:text-gray-800 transition-colors"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                กลับ
              </button>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">📚 {classData.subject_name}</h1>
                <p className="text-gray-600">รหัสคลาส: {classData.class_code}</p>
                {classData.description && (
                  <p className="text-sm text-gray-500 mt-1">{classData.description}</p>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">สร้างเมื่อ</p>
              <p className="font-medium">
                {new Date(classData.created_at).toLocaleDateString('th-TH', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </p>
              <button
                onClick={() => fetchClassAttendanceData()}
                className="mt-2 bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1 rounded-lg text-sm transition-colors"
              >
                🔄 รีเฟรช
              </button>
            </div>
          </div>
        </div>

        {/* Enhanced Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-lg border border-blue-200 p-6 hover:shadow-xl transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-blue-100 rounded-lg">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">นักเรียนทั้งหมด</p>
                <p className="text-3xl font-bold text-gray-900">{attendanceData.totalStudents}</p>
                <p className="text-xs text-gray-500">ลงทะเบียนแล้ว</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg border border-green-200 p-6 hover:shadow-xl transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-green-100 rounded-lg">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">เซสชันทั้งหมด</p>
                <p className="text-3xl font-bold text-gray-900">{attendanceData.totalSessions}</p>
                <p className="text-xs text-gray-500">ครั้ง</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg border border-purple-200 p-6 hover:shadow-xl transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-purple-100 rounded-lg">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">อัตราการเข้าเรียนเฉลี่ย</p>
                <p className="text-3xl font-bold text-gray-900">
                  {(attendanceData.averageAttendance * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-gray-500">ของทุกเซสชัน</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg border border-orange-200 p-6 hover:shadow-xl transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-orange-100 rounded-lg">
                <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">การเช็คชื่อทั้งหมด</p>
                <p className="text-3xl font-bold text-gray-900">{attendanceData.recentAttendance.length}</p>
                <p className="text-xs text-gray-500">รายการ</p>
              </div>
            </div>
          </div>
        </div>

        {/* Attendance Trend Chart */}
        {attendanceData.recentAttendance.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 mb-8">
            <h3 className="text-xl font-bold text-gray-900 mb-4">📈 แนวโน้มการเข้าเรียน (7 วันล่าสุด)</h3>
            <div className="flex items-end space-x-2 h-40">
              {getAttendanceTrend().map((day, index) => (
                <div key={index} className="flex-1 flex flex-col items-center">
                  <div 
                    className="bg-gradient-to-t from-blue-500 to-blue-400 rounded-t w-full flex items-end justify-center text-white text-xs font-medium"
                    style={{ height: `${Math.max(day.count * 20, 20)}px` }}
                  >
                    {day.count > 0 && day.count}
                  </div>
                  <p className="text-xs text-gray-600 mt-2">{day.date}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabs Navigation */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6">
              {[
                { id: 'overview', label: 'ภาพรวม', icon: '📊' },
                { id: 'sessions', label: 'เซสชัน', icon: '🎯' },
                { id: 'students', label: 'นักเรียน', icon: '👥' },
                { id: 'attendance', label: 'การเช็คชื่อ', icon: '✅' },
                { id: 'analytics', label: 'วิเคราะห์', icon: '📈' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setSelectedTab(tab.id)}
                  className={`py-4 px-2 border-b-2 font-medium text-sm ${
                    selectedTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.icon} {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {selectedTab === 'overview' && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-gray-900">📊 ภาพรวมคลาส</h2>
                
                {attendanceData.sessions.length > 0 ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Recent Sessions */}
                    <div className="bg-gray-50 rounded-lg p-6">
                      <h3 className="font-semibold text-gray-900 mb-4">🎯 เซสชันล่าสุด</h3>
                      <div className="space-y-4">
                        {attendanceData.sessions.slice(0, 5).map(session => {
                          const stats = getAttendanceStatsForSession(session.id)
                          const attendanceRate = attendanceData.totalStudents > 0 ? (stats.total / attendanceData.totalStudents) * 100 : 0
                          
                          return (
                            <div key={session.id} className="bg-white rounded-lg p-4 border border-gray-200">
                              <div className="flex justify-between items-start">
                                <div className="flex-1">
                                  <div className="flex items-center space-x-2 mb-2">
                                    <span className="text-lg">
                                      {session.session_type === 'motion_detection' ? '🎯' : '📝'}
                                    </span>
                                    <p className="font-medium text-gray-900">
                                      {session.session_type === 'motion_detection' ? 'Motion Detection' : 'Manual Session'}
                                    </p>
                                    <span className={`px-2 py-1 text-xs rounded-full ${
                                      session.status === 'active' 
                                        ? 'bg-green-100 text-green-800'
                                        : 'bg-gray-100 text-gray-800'
                                    }`}>
                                      {session.status === 'active' ? 'กำลังทำงาน' : 'จบแล้ว'}
                                    </span>
                                  </div>
                                  <p className="text-sm text-gray-500 mb-2">
                                    {new Date(session.start_time).toLocaleString('th-TH')}
                                  </p>
                                  <div className="flex items-center space-x-4 text-xs">
                                    <span className="text-green-600">✅ {stats.present}</span>
                                    <span className="text-yellow-600">⏰ {stats.late}</span>
                                    <span className="text-gray-600">❌ {stats.absent}</span>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="text-lg font-bold text-blue-600">
                                    {stats.total}/{attendanceData.totalStudents}
                                  </p>
                                  <p className="text-sm text-gray-500">
                                    {attendanceRate.toFixed(1)}%
                                  </p>
                                  <div className="w-16 bg-gray-200 rounded-full h-2 mt-2">
                                    <div 
                                      className="bg-blue-500 h-2 rounded-full" 
                                      style={{ width: `${attendanceRate}%` }}
                                    ></div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Top Students */}
                    <div className="bg-gray-50 rounded-lg p-6">
                      <h3 className="font-semibold text-gray-900 mb-4">⭐ นักเรียนที่เข้าเรียนดีที่สุด</h3>
                      <div className="space-y-4">
                        {attendanceData.topStudents.slice(0, 8).map((student, index) => (
                          <div key={student.student_id} className="bg-white rounded-lg p-4 border border-gray-200">
                            <div className="flex items-center space-x-3">
                              <div className="flex-shrink-0">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold ${
                                  index === 0 ? 'bg-yellow-500' :
                                  index === 1 ? 'bg-gray-400' :
                                  index === 2 ? 'bg-orange-600' :
                                  'bg-blue-500'
                                }`}>
                                  {index < 3 ? (index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉') : index + 1}
                                </div>
                              </div>
                              <div className="flex-1">
                                <p className="font-medium text-gray-900">{student.name}</p>
                                <p className="text-sm text-gray-500">{student.student_id}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-lg font-bold text-blue-600">
                                  {student.attendanceCount}/{attendanceData.totalSessions}
                                </p>
                                <p className="text-sm text-gray-500">{student.attendanceRate.toFixed(1)}%</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-16">
                    <div className="bg-gray-100 rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-6">
                      <span className="text-4xl">📊</span>
                    </div>
                    <h3 className="text-xl font-medium text-gray-900 mb-3">ยังไม่มีข้อมูลการเช็คชื่อ</h3>
                    <p className="text-gray-500">เริ่มเซสชันแรกเพื่อดูสถิติการเข้าเรียน</p>
                  </div>
                )}
              </div>
            )}

            {selectedTab === 'sessions' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-2xl font-bold text-gray-900">🎯 เซสชันการเช็คชื่อ</h2>
                  <div className="text-sm text-gray-500">
                    ทั้งหมด {attendanceData.sessions.length} เซสชัน
                  </div>
                </div>
                
                {attendanceData.sessions.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            เซสชัน
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            วันที่/เวลา
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            สถานะ
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            การเข้าเรียน
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            อัตราเข้าเรียน
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            ระยะเวลา
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {attendanceData.sessions.map(session => {
                          const stats = getAttendanceStatsForSession(session.id)
                          const attendanceRate = attendanceData.totalStudents > 0 ? (stats.total / attendanceData.totalStudents) * 100 : 0
                          const duration = session.end_time ? 
                            Math.round((new Date(session.end_time) - new Date(session.start_time)) / (1000 * 60)) : 
                            Math.round((new Date() - new Date(session.start_time)) / (1000 * 60))
                          
                          return (
                            <tr key={session.id} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                  <span className="text-2xl mr-3">
                                    {session.session_type === 'motion_detection' ? '🎯' : '📝'}
                                  </span>
                                  <div>
                                    <div className="text-sm font-medium text-gray-900">
                                      {session.session_type === 'motion_detection' ? 'Motion Detection' : 'Manual Session'}
                                    </div>
                                    <div className="text-sm text-gray-500">ID: {session.id}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">
                                  {new Date(session.start_time).toLocaleDateString('th-TH')}
                                </div>
                                <div className="text-sm text-gray-500">
                                  {new Date(session.start_time).toLocaleTimeString('th-TH')}
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className={`inline-flex px-3 py-1 text-xs font-semibold rounded-full ${
                                  session.status === 'active' 
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-gray-100 text-gray-800'
                                }`}>
                                  {session.status === 'active' ? '✅ ใช้งานอยู่' : '⏹️ จบแล้ว'}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm">
                                <div className="space-y-1">
                                  <div className="flex space-x-4">
                                    <span className="text-green-600 font-medium">✅ {stats.present}</span>
                                    <span className="text-yellow-600 font-medium">⏰ {stats.late}</span>
                                    <span className="text-gray-600 font-medium">❌ {stats.absent}</span>
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    รวม: {stats.total} คน
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                  <div className="flex-1 bg-gray-200 rounded-full h-3 mr-3">
                                    <div 
                                      className="bg-gradient-to-r from-green-500 to-green-600 h-3 rounded-full transition-all duration-300" 
                                      style={{ width: `${attendanceRate}%` }}
                                    ></div>
                                  </div>
                                  <span className="text-sm font-medium text-gray-900 min-w-[50px]">
                                    {attendanceRate.toFixed(1)}%
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                <div>
                                  {Math.floor(duration / 60)}:{(duration % 60).toString().padStart(2, '0')} ชม.
                                </div>
                                {session.status === 'active' && (
                                  <div className="text-xs text-green-600">กำลังทำงาน</div>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-16">
                    <div className="bg-gray-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                      <span className="text-3xl">🎯</span>
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">ยังไม่มีเซสชัน</h3>
                    <p className="text-gray-500">เริ่มเซสชันแรกเพื่อเก็บข้อมูลการเข้าเรียน</p>
                  </div>
                )}
              </div>
            )}

            {selectedTab === 'students' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-2xl font-bold text-gray-900">👥 รายชื่อนักเรียน</h2>
                  <div className="text-sm text-gray-500">
                    ทั้งหมด {attendanceData.enrolledStudents.length} คน
                  </div>
                </div>
                
                {attendanceData.enrolledStudents.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            นักเรียน
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            จำนวนครั้งที่เข้าเรียน
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            อัตราการเข้าเรียน
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            การเข้าเรียนล่าสุด
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            สถิติ
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {attendanceData.topStudents.map((student, index) => {
                          const studentAttendance = getStudentAttendanceHistory(student.student_id)
                          const lastAttendance = studentAttendance[0]
                          const presentCount = studentAttendance.filter(r => r.status === 'present').length
                          const lateCount = studentAttendance.filter(r => r.status === 'late').length
                          
                          return (
                            <tr key={student.student_id} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                  <div className="flex-shrink-0 h-12 w-12">
                                    <div className="h-12 w-12 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center relative">
                                      <span className="text-sm font-medium text-white">
                                        {student.name.charAt(0)}
                                      </span>
                                      {index < 3 && (
                                        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-xs">
                                          {index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div className="ml-4">
                                    <div className="text-sm font-medium text-gray-900">{student.name}</div>
                                    <div className="text-sm text-gray-500">{student.student_id}</div>
                                    <div className="text-xs text-gray-400">{student.email}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-lg font-bold text-blue-600">
                                  {student.attendanceCount} / {attendanceData.totalSessions}
                                </div>
                                <div className="text-xs text-gray-500">ครั้ง</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                  <div className="flex-1 bg-gray-200 rounded-full h-3 mr-3">
                                    <div 
                                      className="bg-gradient-to-r from-blue-500 to-blue-600 h-3 rounded-full transition-all duration-300" 
                                      style={{ width: `${student.attendanceRate}%` }}
                                    ></div>
                                  </div>
                                  <span className="text-sm font-medium text-gray-900 min-w-[50px]">
                                    {student.attendanceRate.toFixed(1)}%
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {lastAttendance ? (
                                  <div>
                                    <div className="text-gray-900">
                                      {new Date(lastAttendance.check_in_time).toLocaleDateString('th-TH')}
                                    </div>
                                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                      lastAttendance.status === 'present' 
                                        ? 'bg-green-100 text-green-800'
                                        : 'bg-yellow-100 text-yellow-800'
                                    }`}>
                                      {lastAttendance.status === 'present' ? 'มาเรียน' : 'มาสาย'}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-gray-400 italic">ยังไม่เคยเข้าเรียน</span>
                                )}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm">
                                <div className="flex space-x-3">
                                  <div className="text-center">
                                    <div className="text-green-600 font-bold">{presentCount}</div>
                                    <div className="text-xs text-gray-500">มาเรียน</div>
                                  </div>
                                  <div className="text-center">
                                    <div className="text-yellow-600 font-bold">{lateCount}</div>
                                    <div className="text-xs text-gray-500">มาสาย</div>
                                  </div>
                                  <div className="text-center">
                                    <div className="text-gray-600 font-bold">
                                      {attendanceData.totalSessions - student.attendanceCount}
                                    </div>
                                    <div className="text-xs text-gray-500">ขาด</div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-16">
                    <div className="bg-gray-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                      <span className="text-3xl">👥</span>
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">ไม่พบข้อมูลนักเรียน</h3>
                    <p className="text-gray-500">ยังไม่มีนักเรียนลงทะเบียนในคลาสนี้</p>
                  </div>
                )}
              </div>
            )}

            {selectedTab === 'attendance' && (
              <div className="space-y-6">
                <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center space-y-4 lg:space-y-0">
                  <h2 className="text-2xl font-bold text-gray-900">✅ บันทึกการเช็คชื่อ</h2>
                  
                  {/* Filters */}
                  <div className="flex flex-wrap gap-4">
                    <select
                      value={dateFilter}
                      onChange={(e) => {
                        setDateFilter(e.target.value)
                        setCurrentPage(1)
                      }}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="all">ทุกช่วงเวลา</option>
                      <option value="week">7 วันล่าสุด</option>
                      <option value="month">30 วันล่าสุด</option>
                    </select>
                    
                    <select
                      value={statusFilter}
                      onChange={(e) => {
                        setStatusFilter(e.target.value)
                        setCurrentPage(1)
                      }}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="all">ทุกสถานะ</option>
                      <option value="present">มาเรียน</option>
                      <option value="late">มาสาย</option>
                    </select>
                    
                    <input
                      type="text"
                      placeholder="ค้นหานักเรียน..."
                      value={studentFilter}
                      onChange={(e) => {
                        setStudentFilter(e.target.value)
                        setCurrentPage(1)
                      }}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[200px]"
                    />
                  </div>
                </div>

                <div className="text-sm text-gray-500">
                  แสดง {getFilteredAttendanceRecords().length} รายการ จากทั้งหมด {attendanceData.recentAttendance.length} รายการ
                </div>
                
                {getFilteredAttendanceRecords().length > 0 ? (
                  <>
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
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              เซสชัน
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {getPaginatedRecords().map((record, index) => {
                            const student = attendanceData.enrolledStudents.find(s => s.student_id === record.student_id)
                            return (
                              <tr key={`${record.id}-${index}`} className="hover:bg-gray-50">
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <div className="flex items-center">
                                    <div className="flex-shrink-0 h-10 w-10">
                                      <div className="h-10 w-10 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center">
                                        <span className="text-sm font-medium text-white">
                                          {(student?.name || record.student_id)?.charAt(0) || 'N'}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="ml-4">
                                      <div className="text-sm font-medium text-gray-900">
                                        {student?.name || 'Unknown Student'}
                                      </div>
                                      <div className="text-sm text-gray-500">{record.student_id}</div>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <div className="text-sm text-gray-900">
                                    {new Date(record.check_in_time).toLocaleDateString('th-TH')}
                                  </div>
                                  <div className="text-sm text-gray-500">
                                    {new Date(record.check_in_time).toLocaleTimeString('th-TH')}
                                  </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <span className={`inline-flex px-3 py-1 text-xs font-semibold rounded-full ${
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
                                <td className="px-6 py-4 whitespace-nowrap">
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
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <div className="flex items-center">
                                    <div className="flex-1 bg-gray-200 rounded-full h-2 mr-2">
                                      <div 
                                        className="bg-gradient-to-r from-green-500 to-green-600 h-2 rounded-full transition-all duration-300" 
                                        style={{ width: `${(record.face_match_score || 0) * 100}%` }}
                                      ></div>
                                    </div>
                                    <span className="text-xs font-medium min-w-[45px]">
                                      {Math.round((record.face_match_score || 0) * 100)}%
                                    </span>
                                  </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  <div className="flex items-center space-x-2">
                                    <span>
                                      {record.attendance_sessions?.session_type === 'motion_detection' ? '🎯' : '📝'}
                                    </span>
                                    <span>
                                      {new Date(record.attendance_sessions?.start_time).toLocaleDateString('th-TH')}
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination */}
                    {getTotalPages() > 1 && (
                      <div className="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3 sm:px-6">
                        <div className="flex flex-1 justify-between sm:hidden">
                          <button
                            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                            disabled={currentPage === 1}
                            className="relative inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            ก่อนหน้า
                          </button>
                          <button
                            onClick={() => setCurrentPage(Math.min(getTotalPages(), currentPage + 1))}
                            disabled={currentPage === getTotalPages()}
                            className="relative ml-3 inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            ถัดไป
                          </button>
                        </div>
                        <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm text-gray-700">
                              แสดง <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> ถึง{' '}
                              <span className="font-medium">
                                {Math.min(currentPage * itemsPerPage, getFilteredAttendanceRecords().length)}
                              </span>{' '}
                              จาก <span className="font-medium">{getFilteredAttendanceRecords().length}</span> รายการ
                            </p>
                          </div>
                          <div>
                            <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
                              <button
                                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                                disabled={currentPage === 1}
                                className="relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50"
                              >
                                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                  <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
                                </svg>
                              </button>
                              
                              {Array.from({ length: getTotalPages() }, (_, i) => i + 1).map(page => (
                                <button
                                  key={page}
                                  onClick={() => setCurrentPage(page)}
                                  className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold ${
                                    currentPage === page
                                      ? 'z-10 bg-blue-600 text-white focus:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600'
                                      : 'text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0'
                                  }`}
                                >
                                  {page}
                                </button>
                              ))}
                              
                              <button
                                onClick={() => setCurrentPage(Math.min(getTotalPages(), currentPage + 1))}
                                disabled={currentPage === getTotalPages()}
                                className="relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50"
                              >
                                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                  <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                                </svg>
                              </button>
                            </nav>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-16">
                    <div className="bg-gray-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                      <span className="text-3xl">✅</span>
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">
                      {attendanceData.recentAttendance.length === 0 ? 'ยังไม่มีการเช็คชื่อ' : 'ไม่พบข้อมูลตามเงื่อนไขที่เลือก'}
                    </h3>
                    <p className="text-gray-500">
                      {attendanceData.recentAttendance.length === 0 
                        ? 'เริ่มเซสชันเพื่อเก็บข้อมูลการเข้าเรียน'
                        : 'ลองเปลี่ยนตัวกรองเพื่อดูข้อมูลอื่น'
                      }
                    </p>
                  </div>
                )}
              </div>
            )}

            {selectedTab === 'analytics' && (
              <div className="space-y-8">
                <h2 className="text-2xl font-bold text-gray-900">📈 วิเคราะห์ข้อมูลการเข้าเรียน</h2>
                
                {attendanceData.recentAttendance.length > 0 ? (
                  <>
                    {/* Attendance Summary */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-6 border border-green-200">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-lg font-semibold text-green-800">การเข้าเรียนทั้งหมด</h3>
                            <p className="text-3xl font-bold text-green-700 mt-2">
                              {attendanceData.attendanceStats.present}
                            </p>
                            <p className="text-sm text-green-600 mt-1">
                              {attendanceData.recentAttendance.length > 0 ? 
                                ((attendanceData.attendanceStats.present / attendanceData.recentAttendance.length) * 100).toFixed(1) : 0
                              }% ของทั้งหมด
                            </p>
                          </div>
                          <div className="text-4xl">✅</div>
                        </div>
                      </div>

                      <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg p-6 border border-yellow-200">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-lg font-semibold text-yellow-800">การมาสาย</h3>
                            <p className="text-3xl font-bold text-yellow-700 mt-2">
                              {attendanceData.attendanceStats.late}
                            </p>
                            <p className="text-sm text-yellow-600 mt-1">
                              {attendanceData.recentAttendance.length > 0 ? 
                                ((attendanceData.attendanceStats.late / attendanceData.recentAttendance.length) * 100).toFixed(1) : 0
                              }% ของทั้งหมด
                            </p>
                          </div>
                          <div className="text-4xl">⏰</div>
                        </div>
                      </div>

                      <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-6 border border-blue-200">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-lg font-semibold text-blue-800">เฉลี่ยต่อเซสชัน</h3>
                            <p className="text-3xl font-bold text-blue-700 mt-2">
                              {attendanceData.totalSessions > 0 ? 
                                (attendanceData.recentAttendance.length / attendanceData.totalSessions).toFixed(1) : 0
                              }
                            </p>
                            <p className="text-sm text-blue-600 mt-1">คน/เซสชัน</p>
                          </div>
                          <div className="text-4xl">📊</div>
                        </div>
                      </div>
                    </div>

                    {/* Detection Method Analysis */}
                    <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">🎯 การกระจายตามวิธีการตรวจจับ</h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {(() => {
                          const detectionMethods = attendanceData.recentAttendance.reduce((acc, record) => {
                            const method = record.detection_method || 'unknown'
                            acc[method] = (acc[method] || 0) + 1
                            return acc
                          }, {})

                          const methodLabels = {
                            'motion_triggered': { label: 'Motion Detection', icon: '🚶', color: 'blue' },
                            'manual_teacher_motion': { label: 'Manual Capture', icon: '📸', color: 'purple' },
                            'motion_session_start': { label: 'Session Start', icon: '🎯', color: 'green' },
                            'unknown': { label: 'Unknown', icon: '❓', color: 'gray' }
                          }

                          return Object.entries(detectionMethods).map(([method, count]) => {
                            const info = methodLabels[method] || methodLabels['unknown']
                            const percentage = ((count / attendanceData.recentAttendance.length) * 100).toFixed(1)
                            
                            return (
                              <div key={method} className={`bg-${info.color}-50 border border-${info.color}-200 rounded-lg p-4`}>
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className={`text-sm font-medium text-${info.color}-800`}>{info.label}</p>
                                    <p className={`text-2xl font-bold text-${info.color}-700 mt-1`}>{count}</p>
                                    <p className={`text-xs text-${info.color}-600`}>{percentage}%</p>
                                  </div>
                                  <div className="text-2xl">{info.icon}</div>
                                </div>
                              </div>
                            )
                          })
                        })()}
                      </div>
                    </div>

                    {/* Time Distribution Analysis */}
                    <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">⏰ การกระจายตามเวลาเช็คชื่อ</h3>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        {(() => {
                          const timeDistribution = attendanceData.recentAttendance.reduce((acc, record) => {
                            const hour = new Date(record.check_in_time).getHours()
                            let timeSlot
                            if (hour >= 6 && hour < 12) timeSlot = 'morning'
                            else if (hour >= 12 && hour < 18) timeSlot = 'afternoon'
                            else if (hour >= 18 && hour < 22) timeSlot = 'evening'
                            else timeSlot = 'night'
                            
                            acc[timeSlot] = (acc[timeSlot] || 0) + 1
                            return acc
                          }, {})

                          const timeSlots = [
                            { key: 'morning', label: 'เช้า (6:00-12:00)', icon: '🌅', color: 'yellow' },
                            { key: 'afternoon', label: 'บ่าย (12:00-18:00)', icon: '☀️', color: 'orange' },
                            { key: 'evening', label: 'เย็น (18:00-22:00)', icon: '🌆', color: 'purple' },
                            { key: 'night', label: 'กลางคืน (22:00-6:00)', icon: '🌙', color: 'blue' }
                          ]

                          return timeSlots.map(slot => {
                            const count = timeDistribution[slot.key] || 0
                            const percentage = attendanceData.recentAttendance.length > 0 ? 
                              ((count / attendanceData.recentAttendance.length) * 100).toFixed(1) : 0
                            
                            return (
                              <div key={slot.key} className={`bg-${slot.color}-50 border border-${slot.color}-200 rounded-lg p-4`}>
                                <div className="text-center">
                                  <div className="text-2xl mb-2">{slot.icon}</div>
                                  <p className={`text-sm font-medium text-${slot.color}-800`}>{slot.label}</p>
                                  <p className={`text-xl font-bold text-${slot.color}-700 mt-1`}>{count}</p>
                                  <p className={`text-xs text-${slot.color}-600`}>{percentage}%</p>
                                </div>
                              </div>
                            )
                          })
                        })()}
                      </div>
                    </div>

                    {/* Face Recognition Accuracy */}
                    <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">🎭 ความแม่นยำการจดจำใบหน้า</h3>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        {(() => {
                          const accuracyRanges = attendanceData.recentAttendance.reduce((acc, record) => {
                            const score = (record.face_match_score || 0) * 100
                            let range
                            if (score >= 90) range = 'excellent'
                            else if (score >= 80) range = 'good'
                            else if (score >= 70) range = 'fair'
                            else range = 'poor'
                            
                            acc[range] = (acc[range] || 0) + 1
                            return acc
                          }, {})

                          const ranges = [
                            { key: 'excellent', label: 'ยอดเยี่ยม (90-100%)', color: 'green', icon: '🎯' },
                            { key: 'good', label: 'ดี (80-89%)', color: 'blue', icon: '👍' },
                            { key: 'fair', label: 'พอใช้ (70-79%)', color: 'yellow', icon: '⚠️' },
                            { key: 'poor', label: 'ต่ำ (<70%)', color: 'red', icon: '❗' }
                          ]

                          return ranges.map(range => {
                            const count = accuracyRanges[range.key] || 0
                            const percentage = attendanceData.recentAttendance.length > 0 ? 
                              ((count / attendanceData.recentAttendance.length) * 100).toFixed(1) : 0
                            
                            return (
                              <div key={range.key} className={`bg-${range.color}-50 border border-${range.color}-200 rounded-lg p-4`}>
                                <div className="text-center">
                                  <div className="text-2xl mb-2">{range.icon}</div>
                                  <p className={`text-sm font-medium text-${range.color}-800`}>{range.label}</p>
                                  <p className={`text-xl font-bold text-${range.color}-700 mt-1`}>{count}</p>
                                  <p className={`text-xs text-${range.color}-600`}>{percentage}%</p>
                                </div>
                              </div>
                            )
                          })
                        })()}
                      </div>
                      
                      <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-600">
                          <strong>คะแนนเฉลี่ย:</strong> {
                            attendanceData.recentAttendance.length > 0 ? 
                              (attendanceData.recentAttendance.reduce((sum, r) => sum + ((r.face_match_score || 0) * 100), 0) / attendanceData.recentAttendance.length).toFixed(1) : 0
                          }%
                        </p>
                      </div>
                    </div>

                    {/* Weekly Attendance Patterns */}
                    <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">📅 รูปแบบการเข้าเรียนรายสัปดาห์</h3>
                      <div className="grid grid-cols-7 gap-2">
                        {(() => {
                          const dayNames = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
                          const dayDistribution = attendanceData.recentAttendance.reduce((acc, record) => {
                            const dayOfWeek = new Date(record.check_in_time).getDay()
                            acc[dayOfWeek] = (acc[dayOfWeek] || 0) + 1
                            return acc
                          }, {})

                          const maxCount = Math.max(...Object.values(dayDistribution), 1)

                          return dayNames.map((dayName, index) => {
                            const count = dayDistribution[index] || 0
                            const intensity = (count / maxCount) * 100
                            
                            return (
                              <div key={index} className="text-center">
                                <div className="text-xs font-medium text-gray-600 mb-2">{dayName}</div>
                                <div 
                                  className="w-full h-20 bg-blue-100 rounded-lg flex items-end justify-center text-white text-xs font-bold relative"
                                  style={{ 
                                    background: `linear-gradient(to top, rgb(59 130 246 / ${Math.max(intensity, 10)}%) 0%, rgb(147 197 253 / 30%) 100%)` 
                                  }}
                                >
                                  {count > 0 && (
                                    <span className="absolute bottom-2 text-blue-800 font-bold">{count}</span>
                                  )}
                                </div>
                              </div>
                            )
                          })
                        })()}
                      </div>
                    </div>

                    {/* Student Performance Distribution */}
                    <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">🏆 การกระจายประสิทธิภาพนักเรียน</h3>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        {(() => {
                          const performanceRanges = attendanceData.topStudents.reduce((acc, student) => {
                            const rate = student.attendanceRate
                            let range
                            if (rate >= 90) range = 'excellent'
                            else if (rate >= 75) range = 'good'
                            else if (rate >= 60) range = 'average'
                            else range = 'needs_improvement'
                            
                            acc[range] = (acc[range] || 0) + 1
                            return acc
                          }, {})

                          const ranges = [
                            { key: 'excellent', label: 'ดีเยี่ยม (≥90%)', color: 'green', icon: '🏆' },
                            { key: 'good', label: 'ดี (75-89%)', color: 'blue', icon: '🥈' },
                            { key: 'average', label: 'ปานกลาง (60-74%)', color: 'yellow', icon: '🥉' },
                            { key: 'needs_improvement', label: 'ต้องปรับปรุง (<60%)', color: 'red', icon: '📚' }
                          ]

                          return ranges.map(range => {
                            const count = performanceRanges[range.key] || 0
                            const percentage = attendanceData.totalStudents > 0 ? 
                              ((count / attendanceData.totalStudents) * 100).toFixed(1) : 0
                            
                            return (
                              <div key={range.key} className={`bg-${range.color}-50 border border-${range.color}-200 rounded-lg p-4`}>
                                <div className="text-center">
                                  <div className="text-3xl mb-2">{range.icon}</div>
                                  <p className={`text-sm font-medium text-${range.color}-800`}>{range.label}</p>
                                  <p className={`text-2xl font-bold text-${range.color}-700 mt-1`}>{count}</p>
                                  <p className={`text-xs text-${range.color}-600`}>{percentage}% นักเรียน</p>
                                </div>
                              </div>
                            )
                          })
                        })()}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-16">
                    <div className="bg-gray-100 rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-6">
                      <span className="text-4xl">📈</span>
                    </div>
                    <h3 className="text-xl font-medium text-gray-900 mb-3">ยังไม่มีข้อมูลสำหรับวิเคราะห์</h3>
                    <p className="text-gray-500">เริ่มเก็บข้อมูลการเช็คชื่อเพื่อดูการวิเคราะห์ที่ครอบคลุม</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ClassDetailView