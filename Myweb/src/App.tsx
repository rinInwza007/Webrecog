import { FC } from 'react'
import { AuthProvider } from './login/AuthContext'
import AppRouter from './router'
import './App.css'

const App: FC = () => {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  )
}

export default App
