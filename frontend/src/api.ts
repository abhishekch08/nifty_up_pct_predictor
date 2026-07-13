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
  price_curve?: { date: string; nifty_close: number; model_strategy_close: number }[]
  calibration: { bucket: string; predicted: number; actual: number; count: number }[]
  threshold_analysis: { threshold: number; trades: number; hit_rate: number; total_return: number }[]
}

export type RecentCalibrationPoint = {
  date: string; next_trading_day: string; predicted_return: number; actual_return: number
  predicted_percent: number; actual_percent: number; nifty_close: number; next_close: number
}

export type StrategyLeg = { action: 'BUY' | 'SELL'; type: 'CE' | 'PE'; strike: number; price: number; expiry: string; lots: number }
export type StrategyCandidate = {
  name: string; family: string; legs: StrategyLeg[]; premium: number; premium_label: string
  max_profit: number; max_loss: number; risk_reward: number | null; expected_profit: number
  probability_profit: number; breakevens: number[]; score: number; unlimited_loss: boolean
  rationale: string; interpretation: string
}
export type StrategyReport = {
  status: string; warning?: string; disclaimer?: string; prediction?: Prediction; spot: number
  date: string; next_trading_day: string; expiry: string; lot_size: number
  expiries?: { expiry: string; label: string; days: number }[]
  selected: StrategyCandidate; candidates: StrategyCandidate[]
  option_chain?: { expiry: string; strike: number; ce_ltp: number; pe_ltp: number; ce_oi: number; pe_oi: number; spot: number }[]
  oi_bars?: { strike: number; call_oi: number; put_oi: number; call_oi_lakh: number; put_oi_lakh: number }[]
  payoff_points: { spot: number; expiry_pl: number; target_pl: number; expected_lower: number; expected_upper: number; current_spot: number }[]
  history: { date: string; next_trading_day: string; strategy: string; probability_up: number; entry_close: number; exit_close: number; nifty_return: number; estimated_pl: number; outcome: string; method: string }[]
}
