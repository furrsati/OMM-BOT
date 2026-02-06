import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { Nav } from "@/components/Nav"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "OMM Trading Bot",
  description: "Solana Memecoin Trading Bot Dashboard",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <div className="min-h-screen bg-zinc-950">
          <Nav />
          <main className="mx-auto max-w-7xl px-4 py-6">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
