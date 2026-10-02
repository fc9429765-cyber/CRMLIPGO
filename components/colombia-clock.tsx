"use client"

import { useEffect, useState } from "react"
import { Clock } from "lucide-react"

export function ColombiaClock() {
  const [dateTime, setDateTime] = useState<string>("")

  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      // Convert to Colombia timezone
      const colombiaTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Bogota" }))

      const formatted = colombiaTime.toLocaleString("es-CO", {
        timeZone: "America/Bogota",
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })

      setDateTime(formatted)
    }

    updateTime()
    const interval = setInterval(updateTime, 1000)

    return () => clearInterval(interval)
  }, [])

  if (!dateTime) return null

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs text-foreground bg-card px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg border border-border shadow-sm">
      <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
      <span className="font-medium whitespace-nowrap">{dateTime}</span>
    </div>
  )
}
