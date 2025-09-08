import { useState, useRef } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'

const FaceRegistration = ({ onComplete }) => {
  const [photos, setPhotos] = useState([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [currentStep, setCurrentStep] = useState(1)
  const [uploadProgress, setUploadProgress] = useState(0)
  const fileInputRef = useRef(null)
  const { user } = useAuth()

  // URL ของ FastAPI server - ปรับให้ตรงกับ server ของคุณ
  const FASTAPI_URL = import.meta.env.VITE_FASTAPI_URL || 'http://localhost:8000'

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files)
    
    if (photos.length + files.length > 5) {
      setError('สามารถอัพโหลดได้สูงสุด 5 รูป')
      return
    }

    // ตรวจสอบขนาดและประเภทไฟล์
    const validFiles = []
    const maxSize = 5 * 1024 * 1024 // 5MB
    
    files.forEach(file => {
      if (!file.type.startsWith('image/')) {
        setError('กรุณาเลือกไฟล์รูปภาพเท่านั้น')
        return
      }
      
      if (file.size > maxSize) {
        setError('ขนาดไฟล์ต้องไม่เกิน 5MB')
        return
      }
      
      validFiles.push(file)
    })

    validFiles.forEach(file => {
      const reader = new FileReader()
      reader.onload = (event) => {
        setPhotos(prev => [...prev, {
          file,
          preview: event.target.result,
          id: Date.now() + Math.random(),
          name: file.name,
          size: file.size
        }])
      }
      reader.readAsDataURL(file)
    })

    setError('')
  }

  const removePhoto = (id) => {
    setPhotos(prev => prev.filter(photo => photo.id !== id))
  }

  const getUserData = async () => {
    try {
      // ดึงข้อมูลนักเรียนจาก users table
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('school_id, email, full_name')
        .eq('user_id', user.id)
        .single()

      if (userError) {
        console.error('Error fetching user data:', userError)
        return null
      }

      return userData
    } catch (error) {
      console.error('Error getting user data:', error)
      return null
    }
  }

  const enrollFaceWithAPI = async (userData) => {
    try {
      setUploadProgress(10)
      
      // สร้าง FormData สำหรับส่งไปยัง FastAPI
      const formData = new FormData()
      
      // เพิ่มข้อมูลนักเรียน
      formData.append('student_id', userData.school_id)
      formData.append('student_email', userData.email)
      
      setUploadProgress(30)
      
      // เพิ่มรูปภาพทั้งหมด
      photos.forEach((photo, index) => {
        formData.append('images', photo.file)
      })
      
      setUploadProgress(50)

      // ส่งข้อมูลไปยัง FastAPI server
      const response = await fetch(`${FASTAPI_URL}/api/face/enroll`, {
        method: 'POST',
        body: formData,
      })

      setUploadProgress(80)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || 'เกิดข้อผิดพลาดในการลงทะเบียนใบหน้า')
      }

      const result = await response.json()
      setUploadProgress(100)
      
      console.log('Face enrollment result:', result)
      
      return result

    } catch (error) {
      console.error('Face enrollment API error:', error)
      throw error
    }
  }

  const handleSubmit = async () => {
    if (photos.length < 1) {
      setError('กรุณาอัพโหลดรูปภาพอย่างน้อย 1 รูป')
      return
    }

    setUploading(true)
    setError('')
    setSuccess('')
    setUploadProgress(0)

    try {
      // ดึงข้อมูลนักเรียน
      const userData = await getUserData()
      
      if (!userData) {
        throw new Error('ไม่พบข้อมูลนักเรียน กรุณาตรวจสอบการลงทะเบียน')
      }

      if (!userData.school_id) {
        throw new Error('ไม่พบรหัสนักเรียน กรุณาติดต่อผู้ดูแลระบบ')
      }

      console.log('Enrolling face for student:', userData)

      // ส่งข้อมูลไปยัง FastAPI สำหรับ Face Recognition
      const enrollmentResult = await enrollFaceWithAPI(userData)

      if (enrollmentResult.success) {
        setSuccess(`✅ ลงทะเบียนใบหน้าสำเร็จ!
        - ประมวลผล: ${enrollmentResult.images_processed}/${enrollmentResult.total_images} รูป
        - คุณภาพ: ${(enrollmentResult.quality_score * 100).toFixed(1)}%
        - ระบบ: ${enrollmentResult.enrollment_type}`)
        
        // รอ 2 วินาทีให้ผู้ใช้อ่านข้อความสำเร็จ
        setTimeout(() => {
          onComplete()
        }, 2000)
      } else {
        throw new Error('การลงทะเบียนใบหน้าไม่สำเร็จ')
      }

    } catch (err) {
      console.error('Error in face registration:', err)
      setError(`เกิดข้อผิดพลาด: ${err.message}`)
      
      // ถ้าเป็นปัญหาการเชื่อมต่อ server
      if (err.message.includes('fetch')) {
        setError(`ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ Face Recognition ได้
        กรุณาตรวจสอบ:
        1. เซิร์ฟเวอร์ FastAPI ทำงานอยู่หรือไม่ (${FASTAPI_URL})
        2. การตั้งค่า CORS
        3. การเชื่อมต่ออินเทอร์เน็ต`)
      }
      
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  // ตรวจสอบสถานะ FastAPI server
  const testServerConnection = async () => {
    try {
      const response = await fetch(`${FASTAPI_URL}/health`)
      const data = await response.json()
      
      if (data.status === 'healthy') {
        setSuccess('✅ เชื่อมต่อกับเซิร์ฟเวอร์ Face Recognition สำเร็จ')
      } else {
        setError('⚠️ เซิร์ฟเวอร์ Face Recognition ไม่พร้อมใช้งาน')
      }
    } catch (error) {
      setError(`❌ ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้: ${FASTAPI_URL}`)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-pink-100">
      <div className="max-w-2xl w-full space-y-8 p-8 bg-white rounded-xl shadow-lg">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            ลงทะเบียนใบหน้า
          </h2>
          <p className="text-gray-600 mb-4">
            อัพโหลดรูปภาพใบหน้าของคุณเพื่อใช้ในการเช็คชื่อด้วยระบบ AI
          </p>
          
          {/* Server Connection Status */}
          <div className="mb-4">
            <button
              onClick={testServerConnection}
              className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-lg transition-colors"
            >
              🔧 ทดสอบการเชื่อมต่อเซิร์ฟเวอร์
            </button>
            <p className="text-xs text-gray-500 mt-1">Server: {FASTAPI_URL}</p>
          </div>
          
          {/* Progress Steps */}
          <div className="flex justify-center mb-8">
            <div className="flex items-center space-x-4">
              <div className="flex items-center">
                <div className="w-8 h-8 bg-green-500 text-white rounded-full flex items-center justify-center text-sm font-medium">
                  ✓
                </div>
                <span className="ml-2 text-sm text-gray-600">สมัครสมาชิก</span>
              </div>
              <div className="w-8 h-px bg-gray-300"></div>
              <div className="flex items-center">
                <div className="w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm font-medium">
                  2
                </div>
                <span className="ml-2 text-sm text-blue-600 font-medium">ลงทะเบียนใบหน้า</span>
              </div>
              <div className="w-8 h-px bg-gray-300"></div>
              <div className="flex items-center">
                <div className="w-8 h-8 bg-gray-300 text-gray-600 rounded-full flex items-center justify-center text-sm font-medium">
                  3
                </div>
                <span className="ml-2 text-sm text-gray-600">เสร็จสิ้น</span>
              </div>
            </div>
          </div>
        </div>

        {/* Upload Progress */}
        {uploading && uploadProgress > 0 && (
          <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">กำลังประมวลผล...</span>
              <span className="text-sm text-gray-500">{uploadProgress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-purple-600 h-2 rounded-full transition-all duration-300" 
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg whitespace-pre-line">
            {error}
          </div>
        )}

        {/* Success Message */}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg whitespace-pre-line">
            {success}
          </div>
        )}

        <div className="space-y-6">
          {/* Instructions */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-medium text-blue-900 mb-2">คำแนะนำในการถ่ายรูป:</h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• ถ่ายรูปในที่ที่มีแสงสว่างเพียงพอ</li>
              <li>• หันหน้าตรงกับกล้อง</li>
              <li>• ไม่ควรใส่แว่นตาหรือหน้ากาก</li>
              <li>• ควรมีท่าทางและสีหน้าที่แตกต่างกัน</li>
              <li>• อัพโหลดอย่างน้อย 1-5 รูป (ยิ่งมากยิ่งแม่นยำ)</li>
              <li>• ขนาดไฟล์ไม่เกิน 5MB ต่อรูป</li>
            </ul>
          </div>

          {/* File Upload */}
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
              disabled={uploading}
            />
            
            <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" stroke="currentColor" fill="none" viewBox="0 0 48 48">
              <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            
            <p className="text-lg font-medium text-gray-900 mb-2">เลือกรูปภาพใบหน้า</p>
            <p className="text-sm text-gray-600 mb-4">รองรับไฟล์ JPG, PNG (สูงสุด 5 รูป, 5MB/รูป)</p>
            
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || photos.length >= 5}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {photos.length >= 5 ? 'ครบ 5 รูปแล้ว' : 'เลือกไฟล์'}
            </button>
          </div>

          {/* Photos Preview */}
          {photos.length > 0 && (
            <div>
              <h3 className="font-medium text-gray-900 mb-4">
                รูปภาพที่เลือก ({photos.length}/5)
                <span className="text-sm font-normal text-gray-600 ml-2">
                  รวม {(photos.reduce((sum, photo) => sum + photo.size, 0) / 1024 / 1024).toFixed(1)} MB
                </span>
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {photos.map((photo) => (
                  <div key={photo.id} className="relative group">
                    <img
                      src={photo.preview}
                      alt="Face preview"
                      className="w-full h-32 object-cover rounded-lg border-2 border-gray-200"
                    />
                    <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all rounded-lg"></div>
                    <button
                      onClick={() => removePhoto(photo.id)}
                      disabled={uploading}
                      className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                    >
                      ×
                    </button>
                    <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                      {(photo.size / 1024 / 1024).toFixed(1)} MB
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Submit Button */}
          <div className="flex space-x-4">
            <button
              onClick={handleSubmit}
              disabled={uploading || photos.length < 1}
              className="flex-1 bg-purple-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-purple-700 focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {uploading ? (
                <div className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  กำลังประมวลผล...
                </div>
              ) : (
                '🤖 บันทึกข้อมูลใบหน้า'
              )}
            </button>
            
            <button
              onClick={() => onComplete()}
              disabled={uploading}
              className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              ข้ามขั้นตอนนี้
            </button>
          </div>

          {/* Additional Info */}
          <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
            <h4 className="font-medium text-gray-900 mb-2">ข้อมูลเพิ่มเติม:</h4>
            <ul className="space-y-1">
              <li>• ข้อมูลใบหน้าจะถูกเข้ารหัสและเก็บอย่างปลอดภัย</li>
              <li>• สามารถอัปเดตข้อมูลใบหน้าได้ในภายหลัง</li>
              <li>• ระบบใช้ AI สำหรับการจดจำใบหน้าที่แม่นยำ</li>
              <li>• รองรับการตรวจจับในสภาพแสงต่างๆ</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FaceRegistration