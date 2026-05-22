// frontend/app/admin/login/page.tsx
'use client'

import { useState } from 'react'
import { setCookie, getCookie, cookieKeys } from '@/lib/cookies'
import { ShieldCheck, Lock, User, AlertCircle } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function AdminLoginPage() {
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    console.log('=== LOGIN ATTEMPT START ===')
    console.log('API URL:', API_URL)
    console.log('Admin code:', code)

    try {
      const response = await fetch(`${API_URL}/auth/admin-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code, password }),
      })

      console.log('Response status:', response.status)
      console.log('Response ok:', response.ok)

      const data = await response.json()
      console.log('Response data:', data)

      if (response.ok) {
        setCookie(cookieKeys.ADMIN_TOKEN, data.token)
        setCookie(cookieKeys.USER_ROLE, data.role);

        // Verify cookie is set before redirect
        const verifyToken = getCookie(cookieKeys.ADMIN_TOKEN)

        if (verifyToken) {
          window.location.href = '/admin/dashboard'
        } else {
          setError('Login failed: Could not save authentication token')
          setLoading(false)
        }
      } else {
        setError(data.detail || 'Login failed')
      }
    } catch (err) {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-30">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-purple-500/5"></div>
        <div className="absolute inset-0" style={{
          backgroundImage: `radial-gradient(circle at 20% 80%, rgba(120, 119, 198, 0.1) 0%, transparent 50%),
                           radial-gradient(circle at 80% 20%, rgba(255, 255, 255, 0.05) 0%, transparent 50%),
                           radial-gradient(circle at 40% 40%, rgba(120, 119, 198, 0.05) 0%, transparent 50%)`,
        }}></div>
      </div>

      {/* Floating Elements */}
      <div className="absolute top-20 left-20 w-72 h-72 bg-blue-500/10 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute bottom-20 right-20 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-to-r from-blue-600/5 to-purple-600/5 rounded-full blur-3xl"></div>

      <div className="relative z-10 min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Logo/Header */}
          <div className="text-center mb-12">
            <div className="relative inline-flex items-center justify-center h-20 w-auto mb-6">
              <img 
                src="https://company-logo-wtn.s3.ap-southeast-2.amazonaws.com/logo.png" 
                alt="Pulse Pharma Logo" 
                className="h-full object-contain relative z-10" 
              />
              <div className="absolute inset-0 bg-white/10 blur-xl rounded-full scale-150"></div>
            </div>
            <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">
              Admin Portal
            </h1>
            <p className="text-slate-300 text-lg font-light">
              Secure access to JD Management System
            </p>
            <div className="mt-4 h-1 w-24 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full mx-auto"></div>
          </div>

          {/* Login Form */}
          <div className="bg-white/10 backdrop-blur-2xl rounded-3xl border border-white/20 p-8 shadow-2xl shadow-black/30 relative overflow-hidden">
            {/* Form Background Glow */}
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 rounded-3xl"></div>

            <div className="relative z-10">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-semibold text-white mb-2">Sign In</h2>
                <p className="text-slate-300 text-sm">Enter your admin credentials</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                {error && (
                  <div className="bg-red-500/20 border border-red-500/30 text-red-300 px-4 py-3 rounded-xl text-sm backdrop-blur-sm">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      {error}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <label className="text-sm font-medium text-slate-200 flex items-center gap-2">
                    <User className="w-4 h-4 text-blue-400" />
                    Admin Code
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      className="w-full px-4 py-4 bg-white/10 border border-white/20 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-400 transition-all backdrop-blur-sm text-lg"
                      placeholder="Enter admin code"
                      required
                      disabled={loading}
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-medium text-slate-200 flex items-center gap-2">
                    <Lock className="w-4 h-4 text-blue-400" />
                    Password
                  </label>
                  <div className="relative">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full px-4 py-4 bg-white/10 border border-white/20 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-400 transition-all backdrop-blur-sm text-lg"
                      placeholder="Enter password"
                      required
                      disabled={loading}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-4 px-6 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold rounded-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-3 shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 relative overflow-hidden group"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                  {loading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span className="relative z-10">Authenticating...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-5 h-5 relative z-10" />
                      <span className="relative z-10">Access Admin Portal</span>
                    </>
                  )}
                </button>
              </form>

              <div className="mt-8 pt-6 border-t border-white/20">
                <div className="flex items-center justify-center gap-4 text-xs text-slate-400">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                    System Online
                  </div>
                  <div className="w-1 h-1 bg-slate-500 rounded-full"></div>
                  <div>Secure Connection</div>
                </div>
                <p className="text-xs text-slate-500 text-center mt-3">
                  Authorized personnel only. All access is monitored and logged.
                </p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center mt-8">
            <p className="text-slate-400 text-sm font-light">
              JD Management System v2.0
            </p>
            <p className="text-slate-500 text-xs mt-1">
              © 2024 Pulse Pharma. Enterprise Solution.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
