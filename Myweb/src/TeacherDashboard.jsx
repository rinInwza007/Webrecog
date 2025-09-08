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
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    fetchTeacherClasses()
  }, [user])

  const fetchTeacherClasses = async () => {
    if (!user) return

    try {
      console.log('Fetching classes for user:', user.id)
      
      // Simple query first
      const { data, error } = await supabase
        .from('classes')
        .select('*')
        .eq('teacher_id', user.id)

      if (error) {
        console.error('Error fetching classes:', error)
        throw error
      }

      console.log('Classes fetched:', data)
      setClasses(data || [])
    } catch (error) {
      console.error('Error in fetchTeacherClasses:', error)
      alert('เกิดข้อผิดพลาดในการโหลดข้อมูลคลาส: ' + error.message)
    } finally {
      setLoading(false)
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
        
        // เพิ่ม teacher_email ใน payload
        const classData = {
            subject_name: newClass.subject_name.trim(),
            description: newClass.description?.trim() || null,
            schedule: newClass.schedule.trim() || null,
            teacher_id: user.id,
            teacher_email: user.email, // เพิ่มบรรทัดนี้
            class_code: classCode
        }

        console.log('Creating class with data:', classData) // debug log

        const { error } = await supabase
            .from('classes')
            .insert([classData])

        if (error) throw error

        alert(`สร้างคลาสเรียนสำเร็จ!\nรหัสคลาส: ${classCode}`)
        setShowCreateModal(false)
        setNewClass({ subject_name: '', description: '', schedule: '' })
        fetchTeacherClasses()
    } catch (error) {
        console.error('Error creating class:', error)
        alert('เกิดข้อผิดพลาดในการสร้างคลาสเรียน: ' + error.message)
    } finally {
        setActionLoading(false)
    }
}

  const deleteClass = async (classId, className) => {
    if (!confirm(`คุณต้องการลบคลาส "${className}" ใช่หรือไม่?`)) {
      return
    }

    setActionLoading(true)

    try {
      const { error } = await supabase
        .from('classes')
        .delete()
        .eq('class_id', classId)

      if (error) throw error

      alert('ลบคลาสเรียนสำเร็จ')
      fetchTeacherClasses()
    } catch (error) {
      console.error('Error deleting class:', error)
      alert('เกิดข้อผิดพลาดในการลบคลาสเรียน: ' + error.message)
    } finally {
      setActionLoading(false)
    }
  }

  const copyClassCode = (classCode) => {
    navigator.clipboard.writeText(classCode)
    alert('คัดลอกรหัสคลาสแล้ว: ' + classCode)
  }

  const handleSignOut = async () => {
    if (confirm('คุณต้องการออกจากระบบใช่หรือไม่?')) {
      await signOut()
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">กำลังโหลดข้อมูล...</p>
        </div>
      </div>
    )
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
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
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
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
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
                        <p className="text-sm text-gray-600 mb-3">
                          เวลาเรียน: {cls.schedule || 'ไม่ระบุ'}
                        </p>
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
                      
                      <button
                        onClick={() => deleteClass(cls.class_id, cls.subject_name)}
                        disabled={actionLoading}
                        className="text-red-500 hover:text-red-700 p-2 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        title="ลบคลาส"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>

                    <div className="border-t pt-4">
                      <p className="text-xs text-gray-500 mb-2">สร้างเมื่อ: {new Date(cls.created_at).toLocaleDateString('th-TH')}</p>
                      <p className="text-sm text-blue-600">แชร์รหัส <strong>{cls.class_code}</strong> ให้นักเรียนเพื่อเข้าร่วมคลาส</p>
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
                    onChange={(e) => setNewClass(prev => ({ ...prev, subject_name: e.target.value }))}
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
                    onChange={(e) => setNewClass(prev => ({ ...prev, schedule: e.target.value }))}
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
                    setShowCreateModal(false)
                    setNewClass({ subject_name: '', schedule: '' })
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
    </div>
  )
}

export default TeacherDashboard