// Empty by default so the bundled dashboard uses the same FastAPI origin.
export const API_URL = import.meta.env.VITE_API_URL || ''

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, init)
  } catch {
    throw new Error('Cannot reach the local API. Keep run.bat open, then refresh this page.')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(body.detail || 'Request failed')
  }
  return response.json()
}

export type Factor = { feature: string; value: number | null; impact?: number; interpretation: string }
export type Prediction = {
  date: string; next_trading_day: string; nifty_close: number; india_vix: number | null
  probability_up: number; probability_down: number; expected_return: number
  expected_upper_range: number; expected_lower_range: number; signal: string; regime: string
  confidence: string; data_quality: string; data_completeness: number; model_version: string
  last_updated: string; top_bullish_factors: Factor[]; top_bearish_factors: Factor[]
}

export type Backtest = {
  model_version: string; start_date: string; end_date: string
  metrics: Record<string, number | boolean | Record<string, boolean>>
  equity_curve: { date: string; equity: number; drawdown: number }[]
  calibration: { bucket: string; predicted: number; actual: number; count: number }[]
  threshold_analysis: { threshold: number; trades: number; hit_rate: number; total_return: number }[]
}
