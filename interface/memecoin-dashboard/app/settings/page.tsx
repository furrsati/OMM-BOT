'use client';

import { useEffect, useState } from 'react';
import { Settings, Save, RefreshCw, RotateCcw, AlertTriangle } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

interface BotSettings {
  // Position Sizing
  maxPositionSize: number;
  minPositionSize: number;
  maxOpenPositions: number;
  maxTotalExposure: number;
  maxSingleTradeRisk: number;

  // Entry Rules
  minConvictionScore: number;
  minSmartWalletCount: number;
  maxTokenAge: number;
  minLiquidityDepth: number;
  maxDipEntry: number;
  minDipEntry: number;

  // Exit Rules
  defaultStopLoss: number;
  earlyDiscoveryStopLoss: number;
  trailingStopActivation: number;
  trailingStopDistance: number;
  timeBasedStopHours: number;

  // Take Profit Levels
  takeProfitLevel1: number;
  takeProfitLevel1Percent: number;
  takeProfitLevel2: number;
  takeProfitLevel2Percent: number;
  takeProfitLevel3: number;
  takeProfitLevel3Percent: number;
  moonbagPercent: number;

  // Daily Limits
  maxDailyLoss: number;
  maxDailyProfit: number;
  losingStreakPause: number;
  weeklyCircuitBreaker: number;

  // Execution
  maxSlippageBuy: number;
  maxSlippageSell: number;
  maxSlippageEmergency: number;
  maxRetries: number;
  targetLatencyMs: number;

  // Notifications
  telegramEnabled: boolean;
  telegramChatId: string;
  discordEnabled: boolean;
  discordWebhook: string;
  emailEnabled: boolean;
  emailAddress: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const fetchSettings = async () => {
    try {
      const response = await fetch(`${API_URL}/settings`);
      if (!response.ok) throw new Error('Failed to fetch');
      const result = await response.json();
      if (result.success) {
        setSettings(result.data);
      }
      setError(null);
    } catch (err) {
      console.error('Error fetching settings:', err);
      setError('Failed to fetch settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const updateSetting = (key: keyof BotSettings, value: number | string | boolean) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
    setHasChanges(true);
    setSuccess(null);
  };

  const saveSettings = async () => {
    if (!settings) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`${API_URL}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      setSuccess('Settings saved successfully');
      setHasChanges(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save settings';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = async () => {
    if (!confirm('Are you sure you want to reset all settings to defaults? This cannot be undone.')) return;

    setSaving(true);
    try {
      const response = await fetch(`${API_URL}/settings/reset`, {
        method: 'POST',
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      await fetchSettings();
      setSuccess('Settings reset to defaults');
      setHasChanges(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reset settings';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-white"></div>
          <p className="text-zinc-400">Loading settings...</p>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <p className="text-zinc-400">Failed to load settings</p>
      </div>
    );
  }

  const NumberInput = ({ label, value, onChange, min, max, step = 1, suffix = '' }: {
    label: string; value: number; onChange: (v: number) => void;
    min?: number; max?: number; step?: number; suffix?: string;
  }) => (
    <div>
      <label className="block text-sm text-zinc-400 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          min={min}
          max={max}
          step={step}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-zinc-600"
        />
        {suffix && <span className="text-zinc-500">{suffix}</span>}
      </div>
    </div>
  );

  const ToggleInput = ({ label, description, value, onChange }: {
    label: string; description: string; value: boolean; onChange: (v: boolean) => void;
  }) => (
    <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-800/50">
      <div>
        <p className="text-zinc-300">{label}</p>
        <p className="text-xs text-zinc-500">{description}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-14 h-7 rounded-full transition-colors ${
          value ? 'bg-green-600' : 'bg-zinc-700'
        }`}
      >
        <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${
          value ? 'left-8' : 'left-1'
        }`} />
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950 p-6 text-white">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                <Settings className="h-8 w-8 text-zinc-400" />
                Settings
              </h1>
              <p className="text-zinc-500 mt-1">Configure bot parameters and preferences</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={resetToDefaults}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 transition-colors"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
              <button
                onClick={saveSettings}
                disabled={saving || !hasChanges}
                className="flex items-center gap-2 rounded-lg bg-green-600 hover:bg-green-700 disabled:bg-green-800 disabled:opacity-50 px-4 py-2 transition-colors"
              >
                {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Changes
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/20 p-4">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-6 rounded-lg bg-green-500/10 border border-green-500/20 p-4">
            <p className="text-green-400">{success}</p>
          </div>
        )}

        {hasChanges && (
          <div className="mb-6 rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-400" />
            <p className="text-yellow-400">You have unsaved changes</p>
          </div>
        )}

        {/* Position Sizing */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Position Sizing</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput label="Max Position Size" value={settings.maxPositionSize} onChange={(v) => updateSetting('maxPositionSize', v)} min={1} max={10} step={0.5} suffix="%" />
            <NumberInput label="Min Position Size" value={settings.minPositionSize} onChange={(v) => updateSetting('minPositionSize', v)} min={0.5} max={5} step={0.5} suffix="%" />
            <NumberInput label="Max Open Positions" value={settings.maxOpenPositions} onChange={(v) => updateSetting('maxOpenPositions', v)} min={1} max={10} />
            <NumberInput label="Max Total Exposure" value={settings.maxTotalExposure} onChange={(v) => updateSetting('maxTotalExposure', v)} min={5} max={50} suffix="%" />
            <NumberInput label="Max Single Trade Risk" value={settings.maxSingleTradeRisk} onChange={(v) => updateSetting('maxSingleTradeRisk', v)} min={0.5} max={5} step={0.5} suffix="%" />
          </div>
        </section>

        {/* Entry Rules */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Entry Rules</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput label="Min Conviction Score" value={settings.minConvictionScore} onChange={(v) => updateSetting('minConvictionScore', v)} min={50} max={100} />
            <NumberInput label="Min Smart Wallet Count" value={settings.minSmartWalletCount} onChange={(v) => updateSetting('minSmartWalletCount', v)} min={1} max={5} />
            <NumberInput label="Max Token Age" value={settings.maxTokenAge} onChange={(v) => updateSetting('maxTokenAge', v)} min={1} max={24} suffix="hours" />
            <NumberInput label="Min Liquidity Depth" value={settings.minLiquidityDepth} onChange={(v) => updateSetting('minLiquidityDepth', v)} min={10000} max={200000} step={5000} suffix="$" />
            <NumberInput label="Min Dip Entry" value={settings.minDipEntry} onChange={(v) => updateSetting('minDipEntry', v)} min={5} max={40} suffix="%" />
            <NumberInput label="Max Dip Entry" value={settings.maxDipEntry} onChange={(v) => updateSetting('maxDipEntry', v)} min={10} max={50} suffix="%" />
          </div>
        </section>

        {/* Exit Rules */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Exit Rules</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput label="Default Stop Loss" value={settings.defaultStopLoss} onChange={(v) => updateSetting('defaultStopLoss', v)} min={10} max={40} suffix="%" />
            <NumberInput label="Early Discovery Stop Loss" value={settings.earlyDiscoveryStopLoss} onChange={(v) => updateSetting('earlyDiscoveryStopLoss', v)} min={5} max={25} suffix="%" />
            <NumberInput label="Trailing Stop Activation" value={settings.trailingStopActivation} onChange={(v) => updateSetting('trailingStopActivation', v)} min={10} max={50} suffix="% gain" />
            <NumberInput label="Trailing Stop Distance" value={settings.trailingStopDistance} onChange={(v) => updateSetting('trailingStopDistance', v)} min={5} max={25} suffix="%" />
            <NumberInput label="Time-Based Stop" value={settings.timeBasedStopHours} onChange={(v) => updateSetting('timeBasedStopHours', v)} min={1} max={12} suffix="hours" />
          </div>
        </section>

        {/* Take Profit */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Take Profit Levels</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <NumberInput label="Level 1 Target" value={settings.takeProfitLevel1} onChange={(v) => updateSetting('takeProfitLevel1', v)} min={10} max={100} suffix="%" />
              <NumberInput label="Level 1 Sell %" value={settings.takeProfitLevel1Percent} onChange={(v) => updateSetting('takeProfitLevel1Percent', v)} min={10} max={50} suffix="%" />
            </div>
            <div className="space-y-2">
              <NumberInput label="Level 2 Target" value={settings.takeProfitLevel2} onChange={(v) => updateSetting('takeProfitLevel2', v)} min={30} max={150} suffix="%" />
              <NumberInput label="Level 2 Sell %" value={settings.takeProfitLevel2Percent} onChange={(v) => updateSetting('takeProfitLevel2Percent', v)} min={10} max={50} suffix="%" />
            </div>
            <div className="space-y-2">
              <NumberInput label="Level 3 Target" value={settings.takeProfitLevel3} onChange={(v) => updateSetting('takeProfitLevel3', v)} min={50} max={300} suffix="%" />
              <NumberInput label="Level 3 Sell %" value={settings.takeProfitLevel3Percent} onChange={(v) => updateSetting('takeProfitLevel3Percent', v)} min={10} max={50} suffix="%" />
            </div>
          </div>
          <div className="mt-4">
            <NumberInput label="Moonbag Percentage" value={settings.moonbagPercent} onChange={(v) => updateSetting('moonbagPercent', v)} min={5} max={30} suffix="%" />
          </div>
        </section>

        {/* Daily Limits */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Daily Limits</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput label="Max Daily Loss" value={settings.maxDailyLoss} onChange={(v) => updateSetting('maxDailyLoss', v)} min={3} max={20} suffix="%" />
            <NumberInput label="Max Daily Profit" value={settings.maxDailyProfit} onChange={(v) => updateSetting('maxDailyProfit', v)} min={5} max={50} suffix="%" />
            <NumberInput label="Losing Streak Pause" value={settings.losingStreakPause} onChange={(v) => updateSetting('losingStreakPause', v)} min={3} max={10} suffix="trades" />
            <NumberInput label="Weekly Circuit Breaker" value={settings.weeklyCircuitBreaker} onChange={(v) => updateSetting('weeklyCircuitBreaker', v)} min={5} max={30} suffix="%" />
          </div>
        </section>

        {/* Execution */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Execution</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput label="Max Slippage (Buy)" value={settings.maxSlippageBuy} onChange={(v) => updateSetting('maxSlippageBuy', v)} min={1} max={10} step={0.5} suffix="%" />
            <NumberInput label="Max Slippage (Sell)" value={settings.maxSlippageSell} onChange={(v) => updateSetting('maxSlippageSell', v)} min={1} max={15} step={0.5} suffix="%" />
            <NumberInput label="Max Slippage (Emergency)" value={settings.maxSlippageEmergency} onChange={(v) => updateSetting('maxSlippageEmergency', v)} min={5} max={25} suffix="%" />
            <NumberInput label="Max Retries" value={settings.maxRetries} onChange={(v) => updateSetting('maxRetries', v)} min={1} max={5} />
            <NumberInput label="Target Latency" value={settings.targetLatencyMs} onChange={(v) => updateSetting('targetLatencyMs', v)} min={100} max={2000} step={100} suffix="ms" />
          </div>
        </section>

        {/* Notifications */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Notifications</h2>
          <div className="space-y-4">
            <ToggleInput
              label="Telegram Notifications"
              description="Receive alerts via Telegram"
              value={settings.telegramEnabled}
              onChange={(v) => updateSetting('telegramEnabled', v)}
            />
            {settings.telegramEnabled && (
              <div>
                <label className="block text-sm text-zinc-400 mb-1">Telegram Chat ID</label>
                <input
                  type="text"
                  value={settings.telegramChatId}
                  onChange={(e) => updateSetting('telegramChatId', e.target.value)}
                  placeholder="Enter your Telegram chat ID"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-zinc-600"
                />
              </div>
            )}

            <ToggleInput
              label="Discord Notifications"
              description="Receive alerts via Discord webhook"
              value={settings.discordEnabled}
              onChange={(v) => updateSetting('discordEnabled', v)}
            />
            {settings.discordEnabled && (
              <div>
                <label className="block text-sm text-zinc-400 mb-1">Discord Webhook URL</label>
                <input
                  type="text"
                  value={settings.discordWebhook}
                  onChange={(e) => updateSetting('discordWebhook', e.target.value)}
                  placeholder="Enter your Discord webhook URL"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-zinc-600"
                />
              </div>
            )}

            <ToggleInput
              label="Email Notifications"
              description="Receive alerts via email"
              value={settings.emailEnabled}
              onChange={(v) => updateSetting('emailEnabled', v)}
            />
            {settings.emailEnabled && (
              <div>
                <label className="block text-sm text-zinc-400 mb-1">Email Address</label>
                <input
                  type="email"
                  value={settings.emailAddress}
                  onChange={(e) => updateSetting('emailAddress', e.target.value)}
                  placeholder="Enter your email address"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-zinc-600"
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
