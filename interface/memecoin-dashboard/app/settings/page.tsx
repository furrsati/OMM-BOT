"use client"

import { useEffect, useState, useCallback } from "react"

interface Settings {
  positionSizing: {
    maxPositionSize: number
    minPositionSize: number
    maxOpenPositions: number
    maxExposure: number
    maxRiskPerTrade: number
  }
  entryRules: {
    minConvictionScore: number
    minSmartWalletCount: number
    maxTokenAge: number
    minLiquidity: number
    dipDepthMin: number
    dipDepthMax: number
  }
  exitRules: {
    hardStopLoss: number
    earlyDiscoveryStopLoss: number
    timeBasedStopHours: number
    trailingStopTier1: number
    trailingStopTier2: number
    trailingStopTier3: number
  }
  takeProfitLevels: {
    tp30: number
    tp60: number
    tp100: number
    tp200: number
  }
  dailyLimits: {
    maxDailyLoss: number
    maxDailyProfit: number
    losingStreakPause: number
    weeklyCircuitBreaker: number
  }
}

const defaultSettings: Settings = {
  positionSizing: {
    maxPositionSize: 5,
    minPositionSize: 1,
    maxOpenPositions: 5,
    maxExposure: 20,
    maxRiskPerTrade: 1.5,
  },
  entryRules: {
    minConvictionScore: 50,
    minSmartWalletCount: 2,
    maxTokenAge: 60,
    minLiquidity: 30000,
    dipDepthMin: 20,
    dipDepthMax: 30,
  },
  exitRules: {
    hardStopLoss: 25,
    earlyDiscoveryStopLoss: 15,
    timeBasedStopHours: 4,
    trailingStopTier1: 15,
    trailingStopTier2: 12,
    trailingStopTier3: 10,
  },
  takeProfitLevels: {
    tp30: 20,
    tp60: 25,
    tp100: 25,
    tp200: 15,
  },
  dailyLimits: {
    maxDailyLoss: 8,
    maxDailyProfit: 15,
    losingStreakPause: 5,
    weeklyCircuitBreaker: 15,
  },
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings")
      const data = await res.json()
      if (data.success && data.data) {
        setSettings({ ...defaultSettings, ...data.data })
      }
    } catch (err) {
      console.error("Failed to fetch settings:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      })
      const data = await res.json()
      if (data.success) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      } else {
        setError(data.error || "Failed to save settings")
      }
    } catch (err) {
      setError("Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (!confirm("Reset all settings to defaults?")) return
    try {
      const res = await fetch("/api/settings/reset", {
        method: "POST",
      })
      const data = await res.json()
      if (data.success) {
        await fetchSettings()
      }
    } catch (err) {
      setError("Failed to reset settings")
    }
  }

  const updateSetting = (category: keyof Settings, key: string, value: number) => {
    setSettings((prev) => ({
      ...prev,
      [category]: {
        ...prev[category],
        [key]: value,
      },
    }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-zinc-400">Loading...</div>
      </div>
    )
  }

  const SettingInput = ({
    label,
    value,
    onChange,
    suffix = "",
    min = 0,
    max = 100,
    step = 1,
  }: {
    label: string
    value: number
    onChange: (v: number) => void
    suffix?: string
    min?: number
    max?: number
    step?: number
  }) => (
    <div className="flex items-center justify-between py-2">
      <label className="text-sm text-zinc-300">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          min={min}
          max={max}
          step={step}
          className="w-24 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-white text-right text-sm focus:outline-none focus:border-zinc-600"
        />
        {suffix && <span className="text-sm text-zinc-500 w-8">{suffix}</span>}
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <div className="flex gap-2">
          <button
            onClick={handleReset}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg font-medium transition-colors"
          >
            Reset to Defaults
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            {saving ? "Saving..." : saved ? "Saved!" : "Save Changes"}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-4 text-sm underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Position Sizing */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h2 className="text-lg font-medium text-white mb-4">Position Sizing</h2>
          <div className="space-y-1">
            <SettingInput
              label="Max Position Size"
              value={settings.positionSizing.maxPositionSize}
              onChange={(v) => updateSetting("positionSizing", "maxPositionSize", v)}
              suffix="%"
              max={10}
            />
            <SettingInput
              label="Min Position Size"
              value={settings.positionSizing.minPositionSize}
              onChange={(v) => updateSetting("positionSizing", "minPositionSize", v)}
              suffix="%"
              max={5}
            />
            <SettingInput
              label="Max Open Positions"
              value={settings.positionSizing.maxOpenPositions}
              onChange={(v) => updateSetting("positionSizing", "maxOpenPositions", v)}
              max={10}
            />
            <SettingInput
              label="Max Exposure"
              value={settings.positionSizing.maxExposure}
              onChange={(v) => updateSetting("positionSizing", "maxExposure", v)}
              suffix="%"
              max={50}
            />
            <SettingInput
              label="Max Risk Per Trade"
              value={settings.positionSizing.maxRiskPerTrade}
              onChange={(v) => updateSetting("positionSizing", "maxRiskPerTrade", v)}
              suffix="%"
              step={0.5}
              max={5}
            />
          </div>
        </div>

        {/* Entry Rules */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h2 className="text-lg font-medium text-white mb-4">Entry Rules</h2>
          <div className="space-y-1">
            <SettingInput
              label="Min Conviction Score"
              value={settings.entryRules.minConvictionScore}
              onChange={(v) => updateSetting("entryRules", "minConvictionScore", v)}
              min={0}
              max={100}
            />
            <SettingInput
              label="Min Smart Wallet Count"
              value={settings.entryRules.minSmartWalletCount}
              onChange={(v) => updateSetting("entryRules", "minSmartWalletCount", v)}
              min={1}
              max={10}
            />
            <SettingInput
              label="Max Token Age"
              value={settings.entryRules.maxTokenAge}
              onChange={(v) => updateSetting("entryRules", "maxTokenAge", v)}
              suffix="min"
              max={1440}
            />
            <SettingInput
              label="Min Liquidity"
              value={settings.entryRules.minLiquidity}
              onChange={(v) => updateSetting("entryRules", "minLiquidity", v)}
              suffix="$"
              max={500000}
              step={1000}
            />
            <SettingInput
              label="Dip Depth Min"
              value={settings.entryRules.dipDepthMin}
              onChange={(v) => updateSetting("entryRules", "dipDepthMin", v)}
              suffix="%"
              max={50}
            />
            <SettingInput
              label="Dip Depth Max"
              value={settings.entryRules.dipDepthMax}
              onChange={(v) => updateSetting("entryRules", "dipDepthMax", v)}
              suffix="%"
              max={50}
            />
          </div>
        </div>

        {/* Exit Rules */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h2 className="text-lg font-medium text-white mb-4">Exit Rules</h2>
          <div className="space-y-1">
            <SettingInput
              label="Hard Stop Loss"
              value={settings.exitRules.hardStopLoss}
              onChange={(v) => updateSetting("exitRules", "hardStopLoss", v)}
              suffix="%"
              min={10}
              max={40}
            />
            <SettingInput
              label="Early Discovery Stop Loss"
              value={settings.exitRules.earlyDiscoveryStopLoss}
              onChange={(v) => updateSetting("exitRules", "earlyDiscoveryStopLoss", v)}
              suffix="%"
              min={5}
              max={30}
            />
            <SettingInput
              label="Time-Based Stop"
              value={settings.exitRules.timeBasedStopHours}
              onChange={(v) => updateSetting("exitRules", "timeBasedStopHours", v)}
              suffix="hrs"
              min={1}
              max={24}
            />
            <SettingInput
              label="Trailing Stop (20-50%)"
              value={settings.exitRules.trailingStopTier1}
              onChange={(v) => updateSetting("exitRules", "trailingStopTier1", v)}
              suffix="%"
              min={5}
              max={25}
            />
            <SettingInput
              label="Trailing Stop (50-100%)"
              value={settings.exitRules.trailingStopTier2}
              onChange={(v) => updateSetting("exitRules", "trailingStopTier2", v)}
              suffix="%"
              min={5}
              max={20}
            />
            <SettingInput
              label="Trailing Stop (100%+)"
              value={settings.exitRules.trailingStopTier3}
              onChange={(v) => updateSetting("exitRules", "trailingStopTier3", v)}
              suffix="%"
              min={5}
              max={15}
            />
          </div>
        </div>

        {/* Daily Limits */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h2 className="text-lg font-medium text-white mb-4">Daily Limits</h2>
          <div className="space-y-1">
            <SettingInput
              label="Max Daily Loss"
              value={settings.dailyLimits.maxDailyLoss}
              onChange={(v) => updateSetting("dailyLimits", "maxDailyLoss", v)}
              suffix="%"
              min={1}
              max={20}
            />
            <SettingInput
              label="Max Daily Profit"
              value={settings.dailyLimits.maxDailyProfit}
              onChange={(v) => updateSetting("dailyLimits", "maxDailyProfit", v)}
              suffix="%"
              min={5}
              max={50}
            />
            <SettingInput
              label="Losing Streak Pause"
              value={settings.dailyLimits.losingStreakPause}
              onChange={(v) => updateSetting("dailyLimits", "losingStreakPause", v)}
              suffix="trades"
              min={3}
              max={10}
            />
            <SettingInput
              label="Weekly Circuit Breaker"
              value={settings.dailyLimits.weeklyCircuitBreaker}
              onChange={(v) => updateSetting("dailyLimits", "weeklyCircuitBreaker", v)}
              suffix="%"
              min={5}
              max={30}
            />
          </div>
        </div>

        {/* Take Profit Levels */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 md:col-span-2">
          <h2 className="text-lg font-medium text-white mb-4">Take Profit Levels (% to sell at each level)</h2>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-2">At +30%</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={settings.takeProfitLevels.tp30}
                  onChange={(e) => updateSetting("takeProfitLevels", "tp30", Number(e.target.value))}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white text-sm focus:outline-none focus:border-zinc-600"
                />
                <span className="text-zinc-500">%</span>
              </div>
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">At +60%</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={settings.takeProfitLevels.tp60}
                  onChange={(e) => updateSetting("takeProfitLevels", "tp60", Number(e.target.value))}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white text-sm focus:outline-none focus:border-zinc-600"
                />
                <span className="text-zinc-500">%</span>
              </div>
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">At +100%</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={settings.takeProfitLevels.tp100}
                  onChange={(e) => updateSetting("takeProfitLevels", "tp100", Number(e.target.value))}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white text-sm focus:outline-none focus:border-zinc-600"
                />
                <span className="text-zinc-500">%</span>
              </div>
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-2">At +200%</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={settings.takeProfitLevels.tp200}
                  onChange={(e) => updateSetting("takeProfitLevels", "tp200", Number(e.target.value))}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white text-sm focus:outline-none focus:border-zinc-600"
                />
                <span className="text-zinc-500">%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
