import { useState, useRef } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'

const FaceRegistration = ({ onComplete }) => {
  const [photos, setPhotos] = useState([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [currentStep, setCurrentStep] = useState(1)
  const fileInputRef = useRef(null)
  const { user } = useAuth()

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files)
    
    if (photos.length + files.length > 5) {
      setError('สามารถอัพโหลดได้สูงสุด 5 รูป')
      return
    }

    files.forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = (event) => {
          setPhotos(prev => [...prev, {
            file,
            preview: event.target.result,
            id: Date.now() + Math.random()
          }])
        }
        reader.readAsDataURL(file)
      }
    })

    setError('')
  }

  const removePhoto = (id) => {
    setPhotos(prev => prev.filter(photo => photo.id !== id))
  }

  const handleSubmit = async () => {
    if (photos.length < 3) {
      setError('กรุณาอัพโหลดรูปภาพอย่างน้อย 3 รูป')
      return
    }

    setUploading(true)
    setError('')

    try {
      const uploadPromises = photos.map(async (photo, index) => {
        // Upload to Supabase Storage
        const fileName = `${user.id}_${Date.now()}_${index}.jpg`
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('face-photos')
          .upload(fileName, photo.file)

        if (uploadError) {
          throw uploadError
        }

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('face-photos')
          .getPublicUrl(fileName)

        // Save to database
        const { error: dbError } = await supabase
          .from('student_faces')
          .insert([
            {
              student_id: user.id,
              photo_url: publicUrl,
              face_embedding: null // Will be processed by FastAPI later
            }
          ])

        if (dbError) {
          throw dbError
        }

        return publicUrl
      })

      await Promise.all(uploadPromises)

      // TODO: Send photos to FastAPI for processing
      // This would typically call your FastAPI endpoint to process face embeddings
      
      onComplete()
    } catch (err) {
      console.error('Error uploading photos:', err)
      setError('เกิดข้อผิดพลาดในการอัพโหลดรูปภาพ: ' + err.message)
    } finally {
      setUploading(false)
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
            อัพโหลดรูปภาพใบหน้าของคุณเพื่อใช้ในการเช็คชื่อ
          </p>
          
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

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
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
              <li>• อัพโหลดอย่างน้อย 3-5 รูป</li>
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
            />
            
            <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" stroke="currentColor" fill="none" viewBox="0 0 48 48">
              <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            
            <p className="text-lg font-medium text-gray-900 mb-2">เลือกรูปภาพใบหน้า</p>
            <p className="text-sm text-gray-600 mb-4">รองรับไฟล์ JPG, PNG (สูงสุด 5 รูป)</p>
            
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              เลือกไฟล์
            </button>
          </div>

          {/* Photos Preview */}
          {photos.length > 0 && (
            <div>
              <h3 className="font-medium text-gray-900 mb-4">รูปภาพที่เลือก ({photos.length}/5)</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {photos.map((photo) => (
                  <div key={photo.id} className="relative group">
                    <img
                      src={photo.preview}
                      alt="Face preview"
                      className="w-full h-32 object-cover rounded-lg border-2 border-gray-200"
                    />
                    <button
                      onClick={() => removePhoto(photo.id)}
                      className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Submit Button */}
          <div className="flex space-x-4">
            <button
              onClick={handleSubmit}
              disabled={uploading || photos.length < 3}
              className="flex-1 bg-purple-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-purple-700 focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {uploading ? (
                <div className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  กำลังอัพโหลด...
                </div>
              ) : (
                'บันทึกข้อมูลใบหน้า'
              )}
            </button>
            
            <button
              onClick={() => onComplete()}
              className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              ข้ามขั้นตอนนี้
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FaceRegistration