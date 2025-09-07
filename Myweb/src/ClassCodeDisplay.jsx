import { useState } from 'react'

const ClassCodeDisplay = ({ classCode, className, onClose }) => {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = text
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch (err) {
        console.error('Unable to copy to clipboard', err)
      }
      document.body.removeChild(textArea)
    }
  }

  const shareMessage = `🎓 เข้าร่วมคลาสเรียน "${className}"\n\n📋 รหัสเข้าร่วม: ${classCode}\n\n📱 วิธีการเข้าร่วม:\n1. เข้าสู่ระบบในแอป\n2. คลิก "เข้าร่วมวิชา"\n3. กรอกรหัส: ${classCode}\n\n🔗 ระบบเช็คชื่อด้วย Face Recognition`

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `เข้าร่วมคลาส ${className}`,
          text: shareMessage
        })
      } catch (err) {
        if (err.name !== 'AbortError') {
          copyToClipboard(shareMessage)
        }
      }
    } else {
      copyToClipboard(shareMessage)
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-semibold text-gray-900">รหัสเข้าร่วมคลาส</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="text-center mb-6">
            <h4 className="text-xl font-bold text-gray-900 mb-2">{className}</h4>
            
            <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-6 mb-4">
              <p className="text-sm text-blue-600 mb-2">รหัสเข้าร่วมคลาส</p>
              <div className="text-4xl font-bold text-blue-800 font-mono tracking-wider mb-3">
                {classCode}
              </div>
              <button
                onClick={() => copyToClipboard(classCode)}
                className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  copied 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                }`}
              >
                {copied ? (
                  <>
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    คัดลอกแล้ว
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    คัดลอกรหัส
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Instructions */}
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <h5 className="font-medium text-gray-900 mb-2">วิธีการให้นักเรียนเข้าร่วม:</h5>
            <ol className="text-sm text-gray-600 space-y-1">
              <li>1. แชร์รหัส <span className="font-mono font-bold text-blue-600">{classCode}</span> ให้นักเรียน</li>
              <li>2. นักเรียนเข้าสู่ระบบและคลิก "เข้าร่วมวิชา"</li>
              <li>3. กรอกรหัสที่ได้รับและกดเข้าร่วม</li>
            </ol>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-3">
            <button
              onClick={handleShare}
              className="flex-1 bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center space-x-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
              </svg>
              <span>แชร์รหัส</span>
            </button>
            
            <button
              onClick={() => copyToClipboard(shareMessage)}
              className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center space-x-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span>คัดลอกข้อความ</span>
            </button>
          </div>

          <div className="mt-4 text-center">
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 text-sm"
            >
              ปิดหน้าต่าง
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ClassCodeDisplay