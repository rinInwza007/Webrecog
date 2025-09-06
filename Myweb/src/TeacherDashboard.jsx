import { useState, useEffect } from 'react'
import { useAuth } from './AuthContext'
import { supabase } from './supabaseClient'

const TeacherDashboard = () => {
  const { user, signOut } = useAuth()
  const [classes, setClasses] = useState([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newClass, setNewClass] = useState({
    subject_name: '',
    schedule: ''
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTeacherClasses()
  }, [user])

  const fetchTeacherClasses = async () => {
    if (!user) return

    try {
      const { data, error } = await supabase
        .from('classes')
        .select(`
          *,
          student_enrollments (
            student_id,
            users!student_enrollments_student_id_fkey (
              full_name,
              email
            )
          )
        `)
        .eq('teacher_id', user.id)

      if (error) throw error
      setClasses(data || [])
    } catch (error) {
      console.error('Error fetching classes:', error)
    } finally {
      setLoading(false)
    }
  }

  const generateClassCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase()
  }

  const createClass = async () => {
    if (!newClass.subject_name.trim()) {
      alert('กรุณากรอกชื่อวิชา')
      return
    }

    try {
      const classCode = generateClassCode()
      
      const { error } = await supabase
        .from('classes')
        .insert([
          {
            subject_name: newClass.subject_name,
            schedule: newClass.schedule,
            teacher_id: user.id,
            class_code: classCode
          }
        ])

      if (error) throw error

      alert('สร้างคลาสเรียนสำเร็จ!')
      setShowCreateModal(false)
      setNewClass({ subject_name: '', schedule: '' })
      fetchTeacherClasses()
    } catch (error) {
      console.error('Error creating class:', error)
      alert('เกิดข้อผิดพลาดในการสร้างคลาสเรียน')
    }
  }

  const startAttendance = async (classId) => {
    try {
      // Create a new session
      const { data: sessionData, error: sessionError } = await supabase
        .from('class_sessions')
        .insert([
          {
            class_id: classId,
            session_date: new Date().toISOString().split('T')[0],
            start_time: new Date().toISOString(),
            status: 'active'
          }
        ])
        .select()
        .single()

      if (sessionError) throw sessionError

      alert('เริ่มเช็คชื่อแล้ว! นักเรียนสามารถเช็คชื่อผ่านกล้องได้')
      
      // TODO: Navigate to attendance camera view
      // This would typically open a camera interface for face recognition
      
    } catch (error) {
      console.error('Error starting attendance:', error)
      alert('เกิดข้อผิดพลาดในการเริ่มเช็คชื่อ')
    }
  }

  const handleSignOut = async () => {
    await signOut()
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-blue-100 rounded-lg">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">คลาสที่สอน</p>
                <p className="text-2xl font-bold text-gray-900">{classes.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-green-100 rounded-lg">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">นักเรียนทั้งหมด</p>
                <p className="text-2xl font-bold text-gray-900">
                  {classes.reduce((total, cls) => total + cls.student_enrollments.length, 0)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-purple-100 rounded-lg">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v6a2 2 0 002 2h6a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">เซสชันเช็คชื่อ</p>
                <p className="text-2xl font-bold text-gray-900">-</p>
              </div>
            </div>
          </div>
        </div>

        {/* Classes Section */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">คลาสเรียนของฉัน</h2>
              <button
                onClick={() => setShowCreateModal(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                สร้างคลาสใหม่
              </button>
            </div>
          </div>

          <div className="p-6">
            {classes.length === 0 ? (
              <div className="text-center py-8">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <h3 className="mt-2 text-sm font-medium text-gray-900">ยังไม่มีคลาสเรียน</h3>
                <p className="mt-1 text-sm text-gray-500">เริ่มต้นโดยการสร้างคลาสเรียนแรก</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {classes.map((cls) => (
                  <div key={cls.class_id} className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">{cls.subject_name}</h3>
                        <p className="text-sm text-gray-600 mb-2">
                          เวลาเรียน: {cls.schedule || 'ไม่ระบุ'}
                        </p>
                        <div className="flex items-center space-x-4">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            รหัส: {cls.class_code}
                          </span>
                          <span className="text-sm text-gray-600">
                            นักเรียน: {cls.student_enrollments.length} คน
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Student List */}
                    {cls.student_enrollments.length > 0 && (
                      <div className="mb-4">
                        <h4 className="text-sm font-medium text-gray-700 mb-2">นักเรียนในคลาส:</h4>
                        <div className="max-h-24 overflow-y-auto">
                          {cls.student_enrollments.map((enrollment, index) => (
                            <div key={index} className="text-sm text-gray-600 py-1">
                              • {enrollment.users?.full_name || enrollment.users?.email}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex space-x-3">
                      <button
                        onClick={() => startAttendance(cls.class_id)}
                        className="flex-1 bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 transition-colors text-sm"
                      >
                        🎥 เริ่มเช็คชื่อ
                      </button>
                      <button
                        className="flex-1 bg-gray-600 text-white py-2 px-4 rounded-lg hover:bg-gray-700 transition-colors text-sm"
                      >
                        📊 ดูสถิติ
                      </button>
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
              <h3 className="text-lg font-medium text-gray-900 mb-4">สร้างคลาสเรียนใหม่</h3>
              
              <div className="space-y-4">
                <div>
                  <label htmlFor="subjectName" className="block text-sm font-medium text-gray-700 mb-2">
                    ชื่อวิชา *
                  </label>
                  <input
                    id="subjectName"
                    type="text"
                    value={newClass.subject_name}
                    onChange={(e) => setNewClass(prev => ({ ...prev, subject_name: e.target.value }))}
                    placeholder="เช่น วิทยาการคอมพิวเตอร์ 101"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                    onChange={(e) => setNewClass(prev => ({ ...prev, schedule: e.target.value }))}
                    placeholder="เช่น จันทร์ 9:00-12:00"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex space-x-3 mt-6">
                <button
                  onClick={createClass}
                  className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  สร้างคลาส
                </button>
                <button
                  onClick={() => {
                    setShowCreateModal(false)
                    setNewClass({ subject_name: '', schedule: '' })
                  }}
                  className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400 transition-colors"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default TeacherDashboard