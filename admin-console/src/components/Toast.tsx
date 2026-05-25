import { useEffect, useState } from 'react'

interface ToastProps {
  message: string
  type?: 'success' | 'error' | 'info'
  onClose: () => void
  duration?: number
}

export default function Toast({ message, type = 'info', onClose, duration = 3000 }: ToastProps) {
  const [show, setShow] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => { setShow(false); setTimeout(onClose, 300) }, duration)
    return () => clearTimeout(timer)
  }, [duration, onClose])

  const colors = {
    success: 'bg-emerald-600 border-emerald-500',
    error: 'bg-red-600 border-red-500',
    info: 'bg-sky-600 border-sky-500',
  }

  return (
    <div className={`fixed top-4 right-4 z-50 transition-all duration-300 ${show ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
      <div className={`${colors[type]} border rounded-lg px-4 py-3 text-white text-sm shadow-lg max-w-sm`}>
        {message}
      </div>
    </div>
  )
}
