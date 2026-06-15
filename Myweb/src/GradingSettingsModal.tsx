/**
 * GradingSettingsModal.tsx
 * ─────────────────────────────────────────────
 * Modal ตั้งค่าคะแนนการเข้าเรียนระดับ class
 * - upsert ลง class_grading_settings
 * - ใช้ DEFAULT_GRADING_SETTINGS เป็น fallback
 * ─────────────────────────────────────────────
 */

import { useState, useEffect, FC } from 'react'
import Swal from 'sweetalert2'
import { supabase } from './supabaseClient'
import type { ClassGradingSettings } from '@/types/class_grading'
import { DEFAULT_GRADING_SETTINGS } from '@/types/class_grading'

interface GradingSettingsModalProps {
  classId: string
  teacherId: string | null
  onClose: () => void
}

type ScoreField = keyof typeof DEFAULT_GRADING_SETTINGS

const SCORE_FIELDS: {
  key: ScoreField
  label: string
  subLabel: string
  color: string
  bg: string
  border: string
}[] = [
  {
    key: 'present_score',
    label: 'มาตรงเวลา',
    subLabel: 'present',
    color: 'text-green-700',
    bg: 'bg-green-50',
    border: 'border-green-100',
  },
  {
    key: 'late_score',
    label: 'มาสาย',
    subLabel: 'late',
    color: 'text-yellow-700',
    bg: 'bg-yellow-50',
    border: 'border-yellow-100',
  },
  {
    key: 'leave_score',
    label: 'ลา',
    subLabel: 'leave',
    color: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-100',
  },
  {
    key: 'absent_score',
    label: 'ขาดเรียน',
    subLabel: 'absent',
    color: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-100',
  },
]

const BAR_COLORS: Record<ScoreField, string> = {
  present_score: 'bg-green-500',
  late_score: 'bg-yellow-400',
  leave_score: 'bg-blue-400',
  absent_score: 'bg-red-400',
  max_attendance_score: 'bg-gray-300',
}

const GradingSettingsModal: FC<GradingSettingsModalProps> = ({
  classId,
  teacherId,
  onClose,
}) => {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [scores, setScores] = useState({ ...DEFAULT_GRADING_SETTINGS })

  // ─── fetch existing settings ───────────────────────────────
  useEffect(() => {
    const fetch = async () => {
      setLoading(true)
      const { data } = await supabase
        .from('class_grading_settings')
        .select('present_score,late_score,leave_score,absent_score,max_attendance_score')
        .eq('class_id', classId)
        .maybeSingle()

      if (data) {
        setScores({
          present_score:        data.present_score,
          late_score:           data.late_score,
          leave_score:          data.leave_score,
          absent_score:         data.absent_score,
          max_attendance_score: data.max_attendance_score,
        })
      }
      setLoading(false)
    }
    fetch()
  }, [classId])

  // ─── helpers ───────────────────────────────────────────────
  const adjust = (key: ScoreField, delta: number) => {
    const step = key === 'max_attendance_score' ? 5 : 0.5
    const min  = key === 'max_attendance_score' ? 1 : 0
    const max  = key === 'max_attendance_score' ? 100 : 10
    setScores(prev => ({
      ...prev,
      [key]: parseFloat(
        Math.min(max, Math.max(min, prev[key] + delta * step)).toFixed(
          key === 'max_attendance_score' ? 0 : 1
        )
      ),
    }))
  }

  const reset = () => setScores({ ...DEFAULT_GRADING_SETTINGS })

  // ─── bar preview (แสดงสัดส่วนคะแนน) ──────────────────────
  const scoreSum =
    scores.present_score + scores.late_score +
    scores.leave_score  + scores.absent_score || 1

  const barFields: ScoreField[] = ['present_score', 'late_score', 'leave_score', 'absent_score']

  // ─── save ──────────────────────────────────────────────────
  const save = async () => {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('class_grading_settings')
        .upsert(
          {
            class_id:             classId,
            updated_by:           teacherId,
            present_score:        scores.present_score,
            late_score:           scores.late_score,
            leave_score:          scores.leave_score,
            absent_score:         scores.absent_score,
            max_attendance_score: scores.max_attendance_score,
          },
          { onConflict: 'class_id' }
        )

      if (error) throw error

      await Swal.fire({
        icon: 'success',
        title: 'บันทึกสำเร็จ',
        text: 'ตั้งค่าคะแนนการเข้าเรียนเรียบร้อยแล้ว',
        timer: 1500,
        showConfirmButton: false,
      })
      onClose()
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  // ─── render ────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg glass-card overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-300">
        <div className="p-8 space-y-6">

          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-xl font-semibold tracking-tight text-gray-900">
                ตั้งค่าคะแนนการเข้าเรียน
              </h3>
              <p className="text-sm text-gray-400 mt-1">
                คะแนนจะถูกคำนวณเมื่อ export ข้อมูล
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-xl transition-all"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Loading */}
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin h-6 w-6 border-2 border-gray-200 border-t-[#0071e3] rounded-full" />
            </div>
          ) : (
            <>
              {/* Score cards */}
              <div className="grid grid-cols-2 gap-3">
                {SCORE_FIELDS.map(({ key, label, subLabel, color, bg, border }) => (
                  <div
                    key={key}
                    className={`${bg} ${border} border rounded-2xl p-4`}
                  >
                    <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${color}`}>
                      {label}
                      <span className="ml-1 opacity-50 normal-case">({subLabel})</span>
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => adjust(key, -1)}
                        className="w-8 h-8 rounded-xl border border-white/80 bg-white/60 text-gray-600 hover:bg-white hover:text-gray-900 transition-all flex items-center justify-center font-bold text-lg"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        value={scores[key]}
                        min={0}
                        max={10}
                        step={0.5}
                        onChange={e =>
                          setScores(prev => ({
                            ...prev,
                            [key]: parseFloat(e.target.value) || 0,
                          }))
                        }
                        className="flex-1 h-9 text-center text-xl font-semibold bg-white/60 border border-white/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 text-gray-900"
                      />
                      <button
                        onClick={() => adjust(key, 1)}
                        className="w-8 h-8 rounded-xl border border-white/80 bg-white/60 text-gray-600 hover:bg-white hover:text-gray-900 transition-all flex items-center justify-center font-bold text-lg"
                      >
                        +
                      </button>
                    </div>
                    <p className="text-[10px] text-center mt-2 text-gray-400">คะแนน / ครั้ง</p>
                  </div>
                ))}
              </div>

              {/* Max score row */}
              <div className="flex items-center justify-between p-4 bg-white/60 rounded-2xl border border-gray-100">
                <div>
                  <p className="text-sm font-semibold text-gray-800">คะแนนเต็มการเข้าเรียน</p>
                  <p className="text-xs text-gray-400 mt-0.5">คะแนนสูงสุดที่นักเรียนได้รับได้</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => adjust('max_attendance_score', -1)}
                    className="w-8 h-8 rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-all flex items-center justify-center font-bold text-lg"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={scores.max_attendance_score}
                    min={1}
                    max={100}
                    step={1}
                    onChange={e =>
                      setScores(prev => ({
                        ...prev,
                        max_attendance_score: parseFloat(e.target.value) || 1,
                      }))
                    }
                    className="w-16 h-9 text-center text-lg font-semibold border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 text-gray-900"
                  />
                  <button
                    onClick={() => adjust('max_attendance_score', 1)}
                    className="w-8 h-8 rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-all flex items-center justify-center font-bold text-lg"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Bar preview */}
              <div className="bg-gray-50/60 rounded-2xl p-4 border border-gray-100 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">
                  สัดส่วนคะแนน (ตัวอย่าง)
                </p>
                <div className="flex h-2.5 rounded-full overflow-hidden gap-0.5">
                  {barFields.map(key => (
                    <div
                      key={key}
                      className={`${BAR_COLORS[key]} transition-all duration-300 rounded-full`}
                      style={{ width: `${(scores[key] / scoreSum) * 100}%` }}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                  {SCORE_FIELDS.map(({ key, label, color }) => (
                    <div key={key} className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${BAR_COLORS[key]}`} />
                      <span className="text-[10px] text-gray-500">
                        {label}{' '}
                        <span className="font-bold text-gray-700">{scores[key].toFixed(1)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={reset}
                  className="flex items-center gap-1.5 px-4 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  รีเซ็ต
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="flex-1 apple-button-primary py-3 flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {saving ? (
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  บันทึกการตั้งค่า
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default GradingSettingsModal