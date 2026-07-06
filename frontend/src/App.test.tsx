import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import App from './App'

globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ detail: 'empty' }) }) as any

test('renders the probabilistic terminal with disclaimer', async () => {
  render(<App />)
  expect(screen.getAllByText('Market Overview').length).toBeGreaterThan(0)
  expect(screen.getByText(/Research tool—not financial advice/i)).toBeInTheDocument()
})
