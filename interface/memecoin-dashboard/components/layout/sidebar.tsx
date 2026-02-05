"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  TrendingUp,
  Wallet,
  Activity,
  Users,
  Brain,
  Shield,
  Bell,
  Settings,
  BarChart3,
  Power,
  FileText,
  Search
} from "lucide-react"

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Controls", href: "/controls", icon: Power },
  { name: "Token Scanner", href: "/scanner", icon: Search },
  { name: "Positions", href: "/positions", icon: TrendingUp },
  { name: "Trades", href: "/trades", icon: BarChart3 },
  { name: "Wallet", href: "/wallet", icon: Wallet },
  { name: "Smart Wallets", href: "/wallets", icon: Users },
  { name: "Execution", href: "/execution", icon: Activity },
  { name: "Learning Engine", href: "/learning", icon: Brain },
  { name: "Safety", href: "/safety", icon: Shield },
  { name: "Alerts", href: "/alerts", icon: Bell },
  { name: "Logs", href: "/logs", icon: FileText },
  { name: "Settings", href: "/settings", icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <div className="flex h-full w-64 flex-col bg-gray-900 text-white">
      <div className="flex h-16 items-center px-6 border-b border-gray-800">
        <h1 className="text-xl font-bold">Trading Bot 🤖</h1>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-gray-800 text-white"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
