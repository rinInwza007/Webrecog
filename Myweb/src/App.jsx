import { useEffect, useState } from "react"
import { supabase } from "Myweb/src/supabaseClient"

function App() {
  const [students, setStudents] = useState([])

  useEffect(() => {
    const fetchStudents = async () => {
      const { data, error } = await supabase
        .from("students") // 📌 ตาราง students (ต้องสร้างใน Supabase ก่อน)
        .select("*")

      if (error) {
        console.error(error)
      } else {
        setStudents(data)
      }
    }

    fetchStudents()
  }, [])

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">📚 Students List</h1>
      <ul className="mt-4 list-disc pl-6">
        {students.map((student) => (
          <li key={student.id}>{student.name}</li>
        ))}
      </ul>
    </div>
  )
}

export default App
