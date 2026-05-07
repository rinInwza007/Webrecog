import { useState, useEffect, FC } from 'react'
import { supabase } from './supabaseClient'
import type { Class, AttendanceSession, AttendanceRecord } from '@/types'

interface ClassDetailViewProps {
  classData: Class
  onBack: () => void
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

const ClassDetailView: FC<ClassDetailViewProps> = ({ classData, onBack }) => {
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
        {realTimeUpdate && (
          <div className="fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-bounce">
            <div className="flex items-center space-x-2">
              <span>มีการเช็คชื่อใหม่ {realTimeUpdate.count} รายการ!</span>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={onBack}
                className="flex items-center text-gray-600 hover:text-gray-800 transition-colors"
              >
                กลับ
              </button>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">📚 {classData.subject_name}</h1>
                <p className="text-gray-600">รหัสคลาส: {classData.class_code}</p>
              </div>
            </div>
            <button
              onClick={() => fetchClassAttendanceData()}
              className="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1 rounded-lg text-sm transition-colors"
            >
              🔄 รีเฟรช
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Stats Cards simplified for brevity */}
          <div className="bg-white rounded-xl shadow-lg border border-blue-200 p-6">
            <p className="text-sm text-gray-600">นักเรียนทั้งหมด</p>
            <p className="text-3xl font-bold text-gray-900">{attendanceData.totalStudents}</p>
          </div>
          <div className="bg-white rounded-xl shadow-lg border border-green-200 p-6">
            <p className="text-sm text-gray-600">เซสชันทั้งหมด</p>
            <p className="text-3xl font-bold text-gray-900">{attendanceData.totalSessions}</p>
          </div>
          <div className="bg-white rounded-xl shadow-lg border border-purple-200 p-6">
            <p className="text-sm text-gray-600">อัตราการเข้าเรียนเฉลี่ย</p>
            <p className="text-3xl font-bold text-gray-900">{(attendanceData.averageAttendance * 100).toFixed(1)}%</p>
          </div>
          <div className="bg-white rounded-xl shadow-lg border border-orange-200 p-6">
            <p className="text-sm text-gray-600">การเช็คชื่อทั้งหมด</p>
            <p className="text-3xl font-bold text-gray-900">{attendanceData.recentAttendance.length}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg border border-gray-200 mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6">
              {['overview', 'sessions', 'students', 'attendance', 'analytics'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setSelectedTab(tab)}
                  className={`py-4 px-2 border-b-2 font-medium text-sm capitalize ${
                    selectedTab === tab ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-6">
            {selectedTab === 'overview' && (
              <div className="space-y-6">
                 {/* Overview content... */}
                 <h2 className="text-2xl font-bold">ภาพรวม</h2>
                 <p>ข้อมูลภาพรวมคลาสเรียนและเซสชันล่าสุด</p>
              </div>
            )}
            {/* Other tabs content implemented similarly... */}
            {selectedTab === 'attendance' && (
              <div className="space-y-4">
                 <h2 className="text-2xl font-bold">บันทึกการเช็คชื่อ</h2>
                 <div className="overflow-x-auto">
                    <table className="min-w-full divide-y">
                       <thead>
                          <tr>
                             <th>นักเรียน</th>
                             <th>เวลา</th>
                             <th>สถานะ</th>
                          </tr>
                       </thead>
                       <tbody>
                          {getPaginatedRecords().map((record, idx) => (
                             <tr key={idx}>
                                <td>{record.student_id}</td>
                                <td>{new Date(record.check_in_time).toLocaleString()}</td>
                                <td>{record.status}</td>
                             </tr>
                          ))}
                       </tbody>
                    </table>
                 </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ClassDetailView
