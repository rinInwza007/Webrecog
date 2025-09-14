import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

const ClassDetailView = ({ classData, onBack }) => {
  const [attendanceData, setAttendanceData] = useState({
    sessions: [],
    totalSessions: 0,
    totalStudents: 0,
    averageAttendance: 0,
    enrolledStudents: [],
    recentAttendance: []
  })
  const [loading, setLoading] = useState(true)
  const [selectedTab, setSelectedTab] = useState('overview')

  useEffect(() => {
    if (classData) {
      fetchClassAttendanceData()
    }
  }, [classData])

  const fetchClassAttendanceData = async () => {
    try {
      setLoading(true)
      console.log('🔍 Fetching attendance data for class:', classData.class_id)

      // Fetch all sessions for this class
      const { data: sessions, error: sessionsError } = await supabase
        .from('attendance_sessions')
        .select('*')
        .eq('class_id', classData.class_id)
        .order('start_time', { ascending: false })

      if (sessionsError) {
        console.error('Error fetching sessions:', sessionsError)
      }

      // Fetch enrolled students (try multiple methods)
      let enrolledStudents = []
      
      // Method 1: Try class_students table
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
        console.warn('class_students table not available or error:', error)
      }

      // Method 2: If no students found, look for attendance records to infer enrollment
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

      // Fetch recent attendance records for all sessions
      const sessionIds = sessions?.map(s => s.id) || []
      let recentAttendance = []
      
      if (sessionIds.length > 0) {
        const { data: attendanceRecords } = await supabase
          .from('attendance_records')
          .select(`
            *,
            attendance_sessions!inner(start_time, session_type)
          `)
          .in('session_id', sessionIds)
          .order('check_in_time', { ascending: false })
          .limit(50)

        recentAttendance = attendanceRecords || []
      }

      // Calculate statistics
      const totalSessions = sessions?.length || 0
      const totalStudents = enrolledStudents.length
      
      // Calculate average attendance rate
      let totalAttendanceRate = 0
      if (sessions && sessions.length > 0 && totalStudents > 0) {
        for (const session of sessions) {
          const sessionAttendance = recentAttendance.filter(r => r.session_id === session.id)
          const attendanceRate = sessionAttendance.length / totalStudents
          totalAttendanceRate += attendanceRate
        }
        totalAttendanceRate = totalSessions > 0 ? totalAttendanceRate / totalSessions : 0
      }

      console.log('📊 Attendance data summary:', {
        totalSessions,
        totalStudents,
        averageAttendance: totalAttendanceRate,
        recentRecords: recentAttendance.length
      })

      setAttendanceData({
        sessions: sessions || [],
        totalSessions,
        totalStudents,
        averageAttendance: totalAttendanceRate,
        enrolledStudents,
        recentAttendance
      })

    } catch (error) {
      console.error('Error fetching class attendance data:', error)
    } finally {
      setLoading(false)
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
      <div className="max-w-6xl mx-auto">
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
                <h1 className="text-2xl font-bold text-gray-900">📚 {classData.subject_name}</h1>
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
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <div className="bg-white rounded-xl shadow-lg border border-blue-200 p-6">
            <div className="flex items-center">
              <div className="p-3 bg-blue-100 rounded-lg">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">นักเรียนทั้งหมด</p>
                <p className="text-2xl font-bold text-gray-900">{attendanceData.totalStudents}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg border border-green-200 p-6">
            <div className="flex items-center">
              <div className="p-3 bg-green-100 rounded-lg">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">เซสชันทั้งหมด</p>
                <p className="text-2xl font-bold text-gray-900">{attendanceData.totalSessions}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg border border-purple-200 p-6">
            <div className="flex items-center">
              <div className="p-3 bg-purple-100 rounded-lg">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">อัตราการเข้าเรียนเฉลี่ย</p>
                <p className="text-2xl font-bold text-gray-900">
                  {(attendanceData.averageAttendance * 100).toFixed(1)}%
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg border border-orange-200 p-6">
            <div className="flex items-center">
              <div className="p-3 bg-orange-100 rounded-lg">
                <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">การเช็คชื่อล่าสุด</p>
                <p className="text-2xl font-bold text-gray-900">{attendanceData.recentAttendance.length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs Navigation */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6">
              {[
                { id: 'overview', label: 'ภาพรวม', icon: '📊' },
                { id: 'sessions', label: 'เซสชัน', icon: '🎯' },
                { id: 'students', label: 'นักเรียน', icon: '👥' },
                { id: 'attendance', label: 'การเช็คชื่อ', icon: '✅' }
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
                <h2 className="text-xl font-bold text-gray-900">📊 ภาพรวมคลาส</h2>
                
                {attendanceData.sessions.length > 0 ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Recent Sessions */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h3 className="font-semibold text-gray-900 mb-3">🎯 เซสชันล่าสุด</h3>
                      <div className="space-y-3">
                        {attendanceData.sessions.slice(0, 5).map(session => {
                          const stats = getAttendanceStatsForSession(session.id)
                          return (
                            <div key={session.id} className="bg-white rounded-lg p-3">
                              <div className="flex justify-between items-start">
                                <div>
                                  <p className="font-medium text-gray-900">
                                    {session.session_type === 'motion_detection' ? '🎯 Motion Detection' : '📝 Manual Session'}
                                  </p>
                                  <p className="text-sm text-gray-500">
                                    {new Date(session.start_time).toLocaleString('th-TH')}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="text-sm font-medium text-green-600">
                                    {stats.total}/{attendanceData.totalStudents} คน
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    {attendanceData.totalStudents > 0 ? Math.round((stats.total / attendanceData.totalStudents) * 100) : 0}%
                                  </p>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Top Students */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h3 className="font-semibold text-gray-900 mb-3">⭐ นักเรียนที่เข้าเรียนบ่อย</h3>
                      <div className="space-y-3">
                        {attendanceData.enrolledStudents.slice(0, 5).map(student => {
                          const studentAttendance = getStudentAttendanceHistory(student.student_id)
                          const attendanceRate = attendanceData.totalSessions > 0 ? (studentAttendance.length / attendanceData.totalSessions) * 100 : 0
                          
                          return (
                            <div key={student.student_id} className="bg-white rounded-lg p-3">
                              <div className="flex justify-between items-center">
                                <div>
                                  <p className="font-medium text-gray-900">{student.name}</p>
                                  <p className="text-sm text-gray-500">{student.student_id}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-sm font-medium text-blue-600">
                                    {studentAttendance.length}/{attendanceData.totalSessions}
                                  </p>
                                  <p className="text-xs text-gray-500">{attendanceRate.toFixed(1)}%</p>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <div className="bg-gray-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                      <span className="text-2xl">📊</span>
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">ยังไม่มีข้อมูลการเช็คชื่อ</h3>
                    <p className="text-gray-500">เริ่มเซสชันแรกเพื่อดูสถิติการเข้าเรียน</p>
                  </div>
                )}
              </div>
            )}

            {selectedTab === 'sessions' && (
              <div className="space-y-6">
                <h2 className="text-xl font-bold text-gray-900">🎯 เซสชันการเช็คชื่อ</h2>
                
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
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {attendanceData.sessions.map(session => {
                          const stats = getAttendanceStatsForSession(session.id)
                          const attendanceRate = attendanceData.totalStudents > 0 ? (stats.total / attendanceData.totalStudents) * 100 : 0
                          
                          return (
                            <tr key={session.id} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                  <span className="text-lg mr-2">
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
                                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                  session.status === 'active' 
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-gray-100 text-gray-800'
                                }`}>
                                  {session.status === 'active' ? '✅ ใช้งานอยู่' : '⏹️ จบแล้ว'}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                <div className="flex space-x-2">
                                  <span className="text-green-600">มาเรียน: {stats.present}</span>
                                  <span className="text-yellow-600">สาย: {stats.late}</span>
                                  <span className="text-gray-600">ขาด: {stats.absent}</span>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                  <div className="flex-1 bg-gray-200 rounded-full h-2 mr-2">
                                    <div 
                                      className="bg-green-500 h-2 rounded-full" 
                                      style={{ width: `${attendanceRate}%` }}
                                    ></div>
                                  </div>
                                  <span className="text-sm font-medium text-gray-900">
                                    {attendanceRate.toFixed(1)}%
                                  </span>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <div className="bg-gray-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                      <span className="text-2xl">🎯</span>
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">ยังไม่มีเซสชัน</h3>
                    <p className="text-gray-500">เริ่มเซสชันแรกเพื่อเก็บข้อมูลการเข้าเรียน</p>
                  </div>
                )}
              </div>
            )}

            {selectedTab === 'students' && (
              <div className="space-y-6">
                <h2 className="text-xl font-bold text-gray-900">👥 รายชื่อนักเรียน</h2>
                
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
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {attendanceData.enrolledStudents.map(student => {
                          const studentAttendance = getStudentAttendanceHistory(student.student_id)
                          const attendanceRate = attendanceData.totalSessions > 0 ? (studentAttendance.length / attendanceData.totalSessions) * 100 : 0
                          const lastAttendance = studentAttendance[0]
                          
                          return (
                            <tr key={student.student_id} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                  <div className="flex-shrink-0 h-10 w-10">
                                    <div className="h-10 w-10 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center">
                                      <span className="text-sm font-medium text-white">
                                        {student.name.charAt(0)}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="ml-4">
                                    <div className="text-sm font-medium text-gray-900">{student.name}</div>
                                    <div className="text-sm text-gray-500">{student.student_id}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {studentAttendance.length} / {attendanceData.totalSessions}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                  <div className="flex-1 bg-gray-200 rounded-full h-2 mr-2">
                                    <div 
                                      className="bg-blue-500 h-2 rounded-full" 
                                      style={{ width: `${attendanceRate}%` }}
                                    ></div>
                                  </div>
                                  <span className="text-sm font-medium text-gray-900">
                                    {attendanceRate.toFixed(1)}%
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {lastAttendance ? (
                                  <div>
                                    <div>{new Date(lastAttendance.check_in_time).toLocaleDateString('th-TH')}</div>
                                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                      lastAttendance.status === 'present' 
                                        ? 'bg-green-100 text-green-800'
                                        : 'bg-yellow-100 text-yellow-800'
                                    }`}>
                                      {lastAttendance.status === 'present' ? 'มาเรียน' : 'มาสาย'}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-gray-400">ยังไม่เคยเข้าเรียน</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <div className="bg-gray-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                      <span className="text-2xl">👥</span>
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">ไม่พบข้อมูลนักเรียน</h3>
                    <p className="text-gray-500">ยังไม่มีนักเรียนลงทะเบียนในคลาสนี้</p>
                  </div>
                )}
              </div>
            )}

            {selectedTab === 'attendance' && (
              <div className="space-y-6">
                <h2 className="text-xl font-bold text-gray-900">✅ บันทึกการเช็คชื่อ</h2>
                
                {attendanceData.recentAttendance.length > 0 ? (
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
                            </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            เซสชัน
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {attendanceData.recentAttendance.map((record, index) => (
                          <tr key={`${record.id}-${index}`} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center">
                                <div className="flex-shrink-0 h-8 w-8">
                                  <div className="h-8 w-8 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center">
                                    <span className="text-xs font-medium text-white">
                                      {record.student_id?.charAt(0) || 'N'}
                                    </span>
                                  </div>
                                </div>
                                <div className="ml-3">
                                  <div className="text-sm font-medium text-gray-900">
                                    {attendanceData.enrolledStudents.find(s => s.student_id === record.student_id)?.name || 'Unknown Student'}
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
                                    className="bg-gradient-to-r from-green-500 to-green-600 h-2 rounded-full" 
                                    style={{ width: `${(record.face_match_score || 0) * 100}%` }}
                                  ></div>
                                </div>
                                <span className="text-xs font-medium">
                                  {Math.round((record.face_match_score || 0) * 100)}%
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              <div>
                                {record.attendance_sessions?.session_type === 'motion_detection' ? '🎯' : '📝'}
                                {' '}
                                {new Date(record.attendance_sessions?.start_time).toLocaleDateString('th-TH')}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <div className="bg-gray-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                      <span className="text-2xl">✅</span>
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">ยังไม่มีการเช็คชื่อ</h3>
                    <p className="text-gray-500">เริ่มเซสชันเพื่อเก็บข้อมูลการเข้าเรียน</p>
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