// src/utils/apiHelper.js
import config from '../config'

class ApiHelper {
  constructor() {
    this.baseURL = config.BACKEND_URL
    this.timeout = config.API_TIMEOUT || 30000
  }

  async fetchWithTimeout(url, options = {}) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      })

      clearTimeout(timeoutId)
      return response
    } catch (error) {
      clearTimeout(timeoutId)
      if (error.name === 'AbortError') {
        throw new Error('Request timeout - โปรดลองใหม่อีกครั้ง')
      }
      throw error
    }
  }

  async testConnection() {
    try {
      console.log('🔧 Testing API connection to:', this.baseURL)
      
      const response = await this.fetchWithTimeout(`${this.baseURL}/health`, {
        method: 'GET',
      })

      if (response.ok) {
        const data = await response.json()
        console.log('✅ API connection successful:', data)
        return { success: true, data }
      } else {
        console.error('❌ API connection failed:', response.status, response.statusText)
        return { 
          success: false, 
          error: `HTTP ${response.status}: ${response.statusText}` 
        }
      }
    } catch (error) {
      console.error('❌ API connection error:', error)
      return { 
        success: false, 
        error: error.message 
      }
    }
  }

  async post(endpoint, data, options = {}) {
    try {
      const url = `${this.baseURL}${endpoint}`
      
      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        ...options,
        body: data instanceof FormData ? data : JSON.stringify(data),
        headers: {
          ...(!(data instanceof FormData) && { 'Content-Type': 'application/json' }),
          ...options.headers,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        let errorMessage
        
        try {
          const errorData = JSON.parse(errorText)
          errorMessage = errorData.detail || errorData.message || `HTTP ${response.status}`
        } catch {
          errorMessage = errorText || `HTTP ${response.status}: ${response.statusText}`
        }
        
        throw new Error(errorMessage)
      }

      return await response.json()
    } catch (error) {
      console.error(`API POST Error [${endpoint}]:`, error)
      throw error
    }
  }

  async get(endpoint, options = {}) {
    try {
      const url = `${this.baseURL}${endpoint}`
      
      const response = await this.fetchWithTimeout(url, {
        method: 'GET',
        ...options,
      })

      if (!response.ok) {
        const errorText = await response.text()
        let errorMessage
        
        try {
          const errorData = JSON.parse(errorText)
          errorMessage = errorData.detail || errorData.message || `HTTP ${response.status}`
        } catch {
          errorMessage = errorText || `HTTP ${response.status}: ${response.statusText}`
        }
        
        throw new Error(errorMessage)
      }

      return await response.json()
    } catch (error) {
      console.error(`API GET Error [${endpoint}]:`, error)
      throw error
    }
  }

  async put(endpoint, data, options = {}) {
    try {
      const url = `${this.baseURL}${endpoint}`
      
      const response = await this.fetchWithTimeout(url, {
        method: 'PUT',
        ...options,
        body: data ? JSON.stringify(data) : undefined,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        let errorMessage
        
        try {
          const errorData = JSON.parse(errorText)
          errorMessage = errorData.detail || errorData.message || `HTTP ${response.status}`
        } catch {
          errorMessage = errorText || `HTTP ${response.status}: ${response.statusText}`
        }
        
        throw new Error(errorMessage)
      }

      return await response.json()
    } catch (error) {
      console.error(`API PUT Error [${endpoint}]:`, error)
      throw error
    }
  }
}

// Export singleton instance
export const apiHelper = new ApiHelper()
export default apiHelper