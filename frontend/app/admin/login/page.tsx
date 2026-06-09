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
    <div className="min-h-screen w-full bg-slate-50 relative flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-16 w-auto mb-4">
            <img 
              src="https://company-logo-wtn.s3.ap-southeast-2.amazonaws.com/logo.png" 
              alt="Pulse Pharma Logo" 
              className="h-full object-contain" 
            />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Admin Portal
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Secure access to JD Management System
          </p>
        </div>

        {/* Login Form */}
        <div className="bg-white rounded-lg border border-slate-200 p-8 shadow-sm relative">
          <div className="relative">
            <div className="text-center mb-6">
              <h2 className="text-lg font-semibold text-slate-900">Sign In</h2>
              <p className="text-slate-500 text-xs mt-1">Enter your admin credentials</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-xs">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {error}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                  Admin Code
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-md text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm shadow-sm"
                    placeholder="Enter admin code"
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                  Password
                </label>
                <div className="relative">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-md text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm shadow-sm"
                    placeholder="Enter password"
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 border border-blue-700 shadow-sm cursor-pointer text-sm mt-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Authenticating...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Access Admin Portal</span>
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t border-slate-200">
              <div className="flex items-center justify-center gap-4 text-[10px] text-slate-400">
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                  System Online
                </div>
                <div className="w-1 h-1 bg-slate-300 rounded-full"></div>
                <div>Secure SSL</div>
              </div>
              <p className="text-[10px] text-slate-400 text-center mt-3">
                Authorized personnel only. Access is monitored and logged.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-slate-400">
          <p className="text-xs">
            JD Management System v2.0
          </p>
          <p className="text-[10px] mt-0.5">
            © 2026 Pulse Pharma. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  )
}
