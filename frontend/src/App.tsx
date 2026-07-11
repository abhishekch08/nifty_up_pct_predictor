import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Activity, AlertTriangle, AreaChart, ArrowDownRight, ArrowUpRight, BarChart3, BookOpen, BrainCircuit,
  CalendarClock, CheckCircle2, ChevronRight, Database, Gauge, Info, Layers3, Menu, RefreshCw,
  Moon, Settings, ShieldCheck, SlidersHorizontal, Sun, Upload, X } from 'lucide-react'
import { Area, AreaChart as ReArea, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, Backtest, Factor, Prediction, StrategyCandidate, StrategyLeg, StrategyReport } from './api'

type Page = 'overview' | 'strategy' | 'flows' | 'derivatives' | 'options' | 'backtest' | 'calibration' | 'models' | 'methodology' | 'admin'

const nav: { id: Page; label: string; icon: typeof Gauge; help: string }[] = [
  { id: 'overview', label: 'Market Overview', icon: Gauge, help: 'Executive dashboard for the next Nifty session. Read this first: it combines the calibrated up-probability, expected return, model range, market regime, data quality, and the strongest feature-level drivers behind the current call.' },
  { id: 'strategy', label: 'Strategy for Tomorrow', icon: CalendarClock, help: 'Defined-risk options strategy lab. It ranks capped-loss Nifty option structures using the model forecast, current option premiums, expected range, probability of profit and reward-to-risk.' },
  { id: 'flows', label: 'FII / DII Flows', icon: ArrowUpRight, help: 'Tracks official cash-market net buying/selling by foreign investors and domestic institutions. These flows often explain liquidity pressure, but the app treats them as after-close information and uses them only for the next session.' },
  { id: 'derivatives', label: 'F&O Positioning', icon: Layers3, help: 'Shows official end-of-day index futures/options positioning by participant class. Net long futures can indicate directional risk appetite; heavy option positioning can indicate hedging, dealer pressure, or crowded strikes.' },
  { id: 'options', label: 'Options Analytics', icon: SlidersHorizontal, help: 'Combines an expected-move calculator with official Nifty options EOD statistics. Use it to understand the market-implied trading band, put/call concentration, and key open-interest walls around spot.' },
  { id: 'backtest', label: 'Backtest', icon: AreaChart, help: 'Shows strict out-of-sample walk-forward results. These numbers answer: if the model had been trained only on past data at each point, how well would its probabilities and threshold signals have behaved?' },
  { id: 'calibration', label: 'Calibration', icon: BarChart3, help: 'Checks whether predicted probabilities are honest. For example, days forecast around 60% up should actually finish up roughly 60% of the time over many observations.' },
  { id: 'models', label: 'Model Lab', icon: BrainCircuit, help: 'Registry of model versions and deployment gates. A model is deployed only if it beats the baseline, has acceptable probability error, and has enough walk-forward evidence.' },
  { id: 'methodology', label: 'How Model Works', icon: BookOpen, help: 'A full methodology report: data sources, cleaning, feature formulas, target definitions, walk-forward design, algorithms, calibration, prediction equations, deployment policy, and limitations.' },
  { id: 'admin', label: 'Admin', icon: Settings, help: 'Operational control room. Fetch data, retrain, deploy eligible models, and upload manual CSVs when a source is delayed or blocked. These actions change the local database/model state.' },
]

const sample: Prediction = {
  date: '—', next_trading_day: '—', nifty_close: 0, india_vix: null, probability_up: .5,
  probability_down: .5, expected_return: 0, expected_upper_range: 0, expected_lower_range: 0,
  signal: 'Awaiting Model', regime: 'Unavailable', confidence: 'Low', data_quality: 'Unsafe',
  data_completeness: 0, model_version: 'not deployed', last_updated: '',
  top_bullish_factors: [], top_bearish_factors: []
}

function App() {
  const [page, setPage] = useState<Page>('overview')
  const [mobile, setMobile] = useState(false)
  const [prediction, setPrediction] = useState<Prediction>(sample)
  const [backtest, setBacktest] = useState<Backtest | null>(null)
  const [models, setModels] = useState<any[]>([])
  const [dataStatus, setDataStatus] = useState<any>({ overall: 'unsafe', datasets: [] })
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [theme, setTheme] = useState(() => localStorage.getItem('nifty-theme') || 'dark')

  const refresh = async () => {
    setLoading(true)
    const [p, b, m, d] = await Promise.allSettled([
      api<Prediction>('/api/latest-prediction'), api<Backtest>('/api/backtest/latest'),
      api<any[]>('/api/models'), api<any>('/api/data-status')
    ])
    if (p.status === 'fulfilled') setPrediction(p.value)
    else setNotice('No deployed prediction yet. Use Admin to fetch data, train, and deploy an eligible model.')
    if (b.status === 'fulfilled') setBacktest(b.value)
    if (m.status === 'fulfilled') setModels(m.value)
    if (d.status === 'fulfilled') setDataStatus(d.value)
    setLoading(false)
  }
  useEffect(() => { refresh() }, [])
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('nifty-theme', theme) }, [theme])
  const currentNav = nav.find(n => n.id === page)

  return <div className="shell">
    <aside className={mobile ? 'sidebar open' : 'sidebar'}>
      <button className="close-mobile" onClick={() => setMobile(false)} aria-label="Close menu"><X /></button>
      <div className="brand"><div className="mark"><Activity size={19}/></div><div><b>NIFTY<span>PROB</span></b><small>RESEARCH TERMINAL</small></div></div>
      <nav>{nav.map(item => <button className={page === item.id ? 'active' : ''} key={item.id} onClick={() => { setPage(item.id); setMobile(false) }}>
        <item.icon size={17}/><span>{item.label}</span><InfoTip text={item.help} compact/>{page === item.id && <ChevronRight className="chev" size={15}/>}</button>)}</nav>
      <div className="sidebar-foot">
        <div className="live-dot"><i/> Pipeline {dataStatus.overall}</div>
        <small>Model {prediction.model_version}</small>
        <small>Probabilities, not promises.</small>
      </div>
    </aside>
    {mobile && <div className="scrim" onClick={() => setMobile(false)}/>} 
    <main>
      <header><button className="menu" onClick={() => setMobile(true)}><Menu/></button><div>
        <span className="eyebrow">NSE · NEXT SESSION INTELLIGENCE</span>
        <h1 className="page-heading">{currentNav?.label}<InfoTip text={currentNav?.help ?? ''}/></h1>
      </div><div className="header-actions"><button className="icon-btn" onClick={()=>setTheme(theme === 'dark' ? 'light' : 'dark')} title="Toggle light/dark mode">{theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}</button><DataBadge status={prediction.data_quality}/><button className="icon-btn" onClick={refresh} title="Refresh"><RefreshCw className={loading ? 'spin' : ''} size={17}/></button></div></header>
      {notice && <div className="notice"><AlertTriangle size={16}/><span>{notice}</span><button onClick={() => setNotice('')}><X size={15}/></button></div>}
      <div className="content">
        {page === 'overview' && <Overview prediction={prediction} backtest={backtest}/>} 
        {page === 'strategy' && <StrategyTomorrow/>}
        {page === 'flows' && <Flows/>}
        {page === 'derivatives' && <Derivatives/>}
        {page === 'options' && <Options prediction={prediction}/>} 
        {page === 'backtest' && <BacktestPage data={backtest}/>} 
        {page === 'calibration' && <Calibration data={backtest}/>} 
        {page === 'models' && <Models rows={models}/>} 
        {page === 'methodology' && <MethodologyReport/>}
        {page === 'admin' && <Admin onDone={refresh} models={models}/>} 
      </div>
    </main>
  </div>
}

function Overview({prediction:p, backtest}:{prediction:Prediction; backtest:Backtest|null}) {
  return <>
    <section className="hero-grid">
      <div className="panel probability-panel">
        <PanelTitle label="Tomorrow's probability" note={`For ${p.next_trading_day}`} help="Calibrated probability that the next Nifty 50 trading session closes higher than the latest verified close. A 60% reading means that historically similar feature states should finish positive about 6 times out of 10, not that the index must rise or that the move size is known."/>
        <ProbabilityGauge value={p.probability_up}/>
        <div className={`signal ${tone(p.signal)}`}>{p.signal}</div>
        <div className="prob-row"><div><span>UP</span><b>{pct(p.probability_up)}</b></div><div><span>DOWN</span><b>{pct(p.probability_down)}</b></div></div>
      </div>
      <div className="panel range-panel">
        <PanelTitle label="Expected next-day range" note="Blended VIX + realized vol + model error" help="Indicative one-session trading band around the latest close. The band uses the larger of model-return uncertainty and a blended volatility estimate, so it is a risk envelope rather than a guaranteed support/resistance zone."/>
        <div className="spot"><span>NIFTY CLOSE</span><b>{num(p.nifty_close)}</b><small>{p.date}</small></div>
        <RangeBar low={p.expected_lower_range} close={p.nifty_close} high={p.expected_upper_range}/>
        <div className="range-stats"><div><ArrowDownRight/><span>Lower bound</span><b>{num(p.expected_lower_range)}</b></div><div><ArrowUpRight/><span>Upper bound</span><b>{num(p.expected_upper_range)}</b></div></div>
      </div>
      <div className="panel regime-panel"><PanelTitle label="Market regime" note="Rules-based state classification" help="A descriptive state label derived from trend, realized volatility and expiry context. It tells you the market backdrop behind the forecast, for example bullish-low-volatility trend versus sideways-high-volatility chop."/>
        <div className="regime-icon"><Activity/></div><h2>{p.regime}</h2><p>Current trend, realized volatility and expiry context.</p>
        <div className="mini-grid"><div><span>EXPECTED RETURN</span><b className={p.expected_return >= 0 ? 'green' : 'red'}>{signedPct(p.expected_return)}</b></div><div><span>CONFIDENCE</span><b>{p.confidence}</b></div><div><span>INDIA VIX</span><b>{p.india_vix?.toFixed(2) ?? '—'}</b></div><div><span>COMPLETENESS</span><b>{pct(p.data_completeness)}</b></div></div>
      </div>
    </section>
    <section className="kpi-row">
      <Kpi label="Walk-forward accuracy" value={metric(backtest, 'accuracy')} sub="Strict out-of-sample" help="Hit rate of the model's historical up/down calls in walk-forward testing. Each test block was predicted by a model trained only on prior dates, so this is a cleaner estimate than an in-sample score."/>
      <Kpi label="Brier score" value={metric(backtest, 'brier_score', 3)} sub="Lower is better" help="Average squared probability error: mean((forecast probability - actual outcome)^2). It rewards well-calibrated probabilities and punishes overconfident wrong calls."/>
      <Kpi label="ROC-AUC" value={metric(backtest, 'roc_auc', 3)} sub="Discrimination" help="Ranking power of the probability score. AUC near 0.50 is no better than random; higher values mean positive days generally receive higher probabilities than negative days."/>
      <Kpi label="Backtest samples" value={backtest ? String(backtest.metrics.samples ?? '—') : '—'} sub="Out-of-sample days" help="Number of unseen historical days used to measure model performance. Low sample counts make accuracy and calibration less stable; this app requires at least one trading year before deployment eligibility."/>
    </section>
    <section className="two-col">
      <div className="panel"><PanelTitle label="Signal drivers" note="One-feature perturbation attribution" help="Explains today's forecast locally. For each feature, the app removes that feature from the latest row and measures how much the probability changes; positive impacts are bullish drivers, negative impacts are bearish drivers."/><div className="factor-columns">
        <FactorList title="BULLISH" factors={p.top_bullish_factors} kind="up"/><FactorList title="BEARISH" factors={p.top_bearish_factors} kind="down"/>
      </div></div>
      <div className="panel"><PanelTitle label="Calibration snapshot" note="Predicted probability vs observed hit rate" help="Reliability check for the probability scale. If predictions around 60% actually win close to 60% of the time, the model is calibrated; large gaps mean the probability should be treated with more caution."/>
        {backtest?.calibration?.length ? <ResponsiveContainer width="100%" height={230}><LineChart data={backtest.calibration}><CartesianGrid stroke="#1b302c" vertical={false}/><XAxis dataKey="predicted" tickFormatter={(v)=>pct(v)} stroke="#66807a"/><YAxis domain={[0,1]} tickFormatter={(v)=>pct(v)} stroke="#66807a"/><Tooltip contentStyle={tip}/><Line dataKey="actual" stroke="#51e6a6" strokeWidth={2} dot={{fill:'#51e6a6'}}/><Line dataKey="predicted" stroke="#516761" strokeDasharray="5 5" dot={false}/></LineChart></ResponsiveContainer> : <Empty text="Calibration appears after the first backtest."/>}
      </div>
    </section>
    <Disclaimer/>
  </>
}

function Flows() {
  const [rows, setRows] = useState<any[]>([])
  useEffect(()=>{ api<any[]>('/api/fii-dii/history?limit=60').then(setRows).catch(()=>{}) },[])
  const chart = [...rows].reverse()
  return <><section className="two-col"><div className="panel wide"><PanelTitle label="Institutional cash flow" note="₹ crore · FII vs DII net activity" help="Daily net buying or selling in the cash market. Positive FII/DII net flow indicates net buying support; negative flow indicates net selling pressure. It is not used for the same session because the official data is known after market close."/>
    {chart.length ? <ResponsiveContainer width="100%" height={340}><BarChart data={chart}><CartesianGrid stroke="#1b302c" vertical={false}/><XAxis dataKey="date" hide/><YAxis stroke="#66807a"/><Tooltip contentStyle={tip}/><Bar dataKey="fii_net" fill="#f06a69" radius={[2,2,0,0]}/><Bar dataKey="dii_net" fill="#51e6a6" radius={[2,2,0,0]}/></BarChart></ResponsiveContainer> : <Empty text="Upload FII/DII CSV from Admin to activate flow analytics."/>}
  </div><div className="panel"><PanelTitle label="Availability discipline" note="Close-to-next-session alignment" help="Prevents look-ahead bias. FII/DII activity published after the close is assigned to the next prediction cycle, so the model never uses information that would not have been known before the forecast was made."/><div className="explain-block"><ShieldCheck/><h3>No same-session leakage</h3><p>Cash activity stamped after the Indian close is used only to predict the next trading session.</p></div></div></section>
  <div className="panel table-panel"><PanelTitle label="Recent observations" note={`${rows.length} rows loaded`} help="Most recent imported official FII/DII rows. Use this table to verify date alignment, net flow values, gross buy/sell activity, and source provenance before trusting flow-driven signals."/><Table columns={['date','fii_net','dii_net','fii_buy','fii_sell','source']} rows={rows.slice(0,20)}/></div></>
}

function Derivatives() {
  const [rows,setRows]=useState<any[]>([])
  useEffect(()=>{api<any[]>('/api/fno/latest').then(setRows).catch(()=>{})},[])
  return <section className="panel"><PanelTitle label="Participant positioning" note="Index futures net long / short" help="Official NSE participant-level open interest. Net index futures equals long contracts minus short contracts; positive values show directional long exposure, while negative values show net short exposure for that participant group."/>
    {rows.length ? <div className="position-grid">{rows.map(r=><div className="position" key={r.participant}><span>{r.participant}</span><b className={r.index_futures_net>=0?'green':'red'}>{num(r.index_futures_net)}</b><small>NET INDEX FUTURES</small><div className="split"><i style={{width:`${Math.max(8,Math.min(92,100*(r.index_futures_long/(r.index_futures_long+r.index_futures_short))))}%`}}/></div></div>)}</div> : <Empty text="Participant OI is unavailable. Import official NSE EOD participant data to populate this module."/>}
  </section>
}

function Options({prediction:p}:{prediction:Prediction}) {
  const [spot,setSpot]=useState(p.nifty_close||25000); const [vix,setVix]=useState(p.india_vix||14); const [days,setDays]=useState(1)
  const [chain,setChain]=useState<any>(null)
  useEffect(()=>{api<any>('/api/options/latest').then(setChain).catch(()=>{})},[])
  const d365=vix/100/Math.sqrt(365)*Math.sqrt(days), d252=vix/100/Math.sqrt(252)*Math.sqrt(days)
  return <section className="two-col"><div className="panel"><PanelTitle label="Expected range calculator" note="VIX annualized conventions" help="Converts annualized India VIX into an expected move over the selected number of days. The 365-day convention uses calendar days; the 252-day convention uses trading days, so it usually gives a slightly wider move."/>
    <div className="form-grid"><label>Nifty CMP<input type="number" value={spot} onChange={e=>setSpot(+e.target.value)}/></label><label>India VIX<input type="number" value={vix} onChange={e=>setVix(+e.target.value)}/></label><label>Days to expiry<input type="number" min="1" max="60" value={days} onChange={e=>setDays(+e.target.value)}/></label></div>
    <div className="calc-results"><div><span>365-DAY LOWER</span><b>{num(spot*(1-d365))}</b></div><div><span>365-DAY UPPER</span><b>{num(spot*(1+d365))}</b></div><div><span>252-DAY LOWER</span><b>{num(spot*(1-d252))}</b></div><div><span>252-DAY UPPER</span><b>{num(spot*(1+d252))}</b></div></div>
  </div><div className="panel"><PanelTitle label="Options-chain analytics" note="Official NSE EOD bhavcopy" help="Summarizes the nearest valid Nifty options expiry from the official end-of-day bhavcopy. PCR, call wall and put wall reveal where open interest is concentrated, which can mark hedging pressure or crowded strike zones." />{chain && chain.status !== 'unavailable' ? <div className="calc-results"><div><span>PCR BY OI</span><b>{chain.pcr_oi?.toFixed(2) ?? '—'}</b></div><div><span>SPOT</span><b>{num(chain.spot)}</b></div><div><span>CALL WALL</span><b>{num(chain.call_wall)}</b></div><div><span>PUT WALL</span><b>{num(chain.put_wall)}</b></div><div><span>TOTAL CALL OI</span><b>{num(chain.total_call_oi)}</b></div><div><span>TOTAL PUT OI</span><b>{num(chain.total_put_oi)}</b></div></div> : <Empty text="Official NSE options EOD data has not been published yet. Restart later or use the CSV fallback."/>}</div></section>
}

function StrategyTomorrow() {
  const [report,setReport]=useState<StrategyReport|null>(null)
  const [expiry,setExpiry]=useState('')
  const [selectedName,setSelectedName]=useState('')
  const [legs,setLegs]=useState<StrategyLeg[]>([])
  const [tab,setTab]=useState<'graph'|'pl'|'greeks'|'chart'>('graph')
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(false)
  useEffect(()=>{
    let alive=true
    setLoading(true); setError('')
    api<StrategyReport>(`/api/strategy/tomorrow${expiry ? `?expiry=${expiry}` : ''}`).then(r=>{
      if(!alive) return
      setReport(r); setLoading(false)
      if(r.status==='complete'){
        setSelectedName(r.selected.name)
        setLegs(cloneLegs(r.selected.legs))
        if(!expiry) setExpiry(r.expiry)
      }
    }).catch(e=>{if(alive){setError((e as Error).message);setLoading(false)}})
    return()=>{alive=false}
  },[expiry])
  if (error) return <div className="panel"><Empty text={error}/></div>
  if (!report) return <div className="panel"><Empty text="Ranking capped-risk strategies from the latest model forecast and option chain…"/></div>
  if (report.status !== 'complete') return <div className="panel"><Empty text={report.warning || 'Strategy engine is waiting for prediction and options-chain data.'}/></div>
  const selected=report.candidates.find(c=>c.name===selectedName)||report.selected
  const activeLegs=legs.length ? legs : cloneLegs(selected.legs)
  const payoff=buildStrategyPayoff(report, activeLegs)
  const summary=summarizeStrategy(report, selected, activeLegs, payoff)
  const chartData=attachOiBars(payoff.points, report.oi_bars||[])
  const comparison=report.candidates.map(c=>({strategy:c.name, family:c.family, pop:c.probability_profit, expected_pl:c.expected_profit, max_profit:c.max_profit, max_loss:-c.max_loss, rr:c.risk_reward ?? 0}))
  const history=report.history.slice(0,14).map(h=>({date:h.date, suggested:h.strategy, prob_up:h.probability_up, nifty_return:h.nifty_return, estimated_pl:h.estimated_pl, outcome:h.outcome}))
  const expiryOptions=report.expiries?.length ? report.expiries : [{expiry:report.expiry,label:report.expiry,days:0}]
  const strikeStep=strikeStepFromChain(report.option_chain)||50
  const lotValue=activeLegs[0]?.lots || 1
  const updateLeg=(index:number, patch:Partial<StrategyLeg>)=>setLegs(prev=>prev.map((leg,i)=>{
    if(i!==index) return leg
    const next={...leg,...patch}
    if(patch.strike!==undefined || patch.type!==undefined || patch.expiry!==undefined) next.price=marketPrice(report,next) ?? next.price
    return next
  }))
  const chooseCandidate=(candidate:StrategyCandidate)=>{setSelectedName(candidate.name);setLegs(cloneLegs(candidate.legs));setTab('graph')}
  const shiftAll=(amount:number)=>setLegs(prev=>prev.map(leg=>{const next={...leg,strike:Math.max(strikeStep, leg.strike+amount)};return {...next,price:marketPrice(report,next) ?? next.price}}))
  const multiplyLots=(lots:number)=>setLegs(prev=>prev.map(leg=>({...leg,lots:Math.max(1,lots||1)})))
  const resetPrices=()=>setLegs(prev=>prev.map(leg=>({...leg,price:marketPrice(report,leg) ?? leg.price})))
  const clearStrategy=()=>setLegs([])
  return <>
    <section className="strategy-builder">
      <div className="strategy-left">
        <div className="strategy-topbar">
          <div className="strategy-search"><span>NIFTY</span><b>{num(report.spot)}</b><em>{report.prediction?.signal}</em></div>
          <button className="settings-pill" type="button"><Settings size={16}/> Settings</button>
        </div>
        <div className="panel strategy-ticket sensi-card">
          <PanelTitle label="New Strategy" note={`${activeLegs.length} selected - ${selected.name}`} help="Editable version of the suggested capped-loss strategy. Change expiry, strike, option type, lots or entry price and the payoff graph, max profit/loss, breakevens and estimated P/L recalculate immediately. Changing the main expiry reruns the backend ranking from that expiry's option chain."/>
          <div className="ticket-actions"><button onClick={clearStrategy}>Clear New Trades</button><button onClick={resetPrices}><RefreshCw size={15}/> Reset Prices</button></div>
          <div className="legs-table editable">
            <div className="legs-head"><span></span><span>B/S</span><span>Expiry</span><span>Strike</span><span>Type</span><span>Lots</span><span>Price</span></div>
            {activeLegs.map((leg,i)=><div className="leg-row" key={`${i}-${leg.action}-${leg.type}-${leg.strike}`}>
              <input aria-label="Include leg" type="checkbox" checked readOnly/>
              <select className={leg.action==='BUY'?'buy-select':'sell-select'} value={leg.action} onChange={e=>updateLeg(i,{action:e.target.value as 'BUY'|'SELL'})}><option value="BUY">B</option><option value="SELL">S</option></select>
              <select value={expiry} onChange={e=>setExpiry(e.target.value)}>{expiryOptions.map(x=><option key={x.expiry} value={x.expiry}>{x.label}</option>)}</select>
              <div className="step-input"><button onClick={()=>updateLeg(i,{strike:leg.strike-strikeStep})}>−</button><input type="number" step={strikeStep} value={leg.strike} onChange={e=>updateLeg(i,{strike:+e.target.value})}/><button onClick={()=>updateLeg(i,{strike:leg.strike+strikeStep})}>+</button></div>
              <select value={leg.type} onChange={e=>updateLeg(i,{type:e.target.value as 'CE'|'PE'})}><option>CE</option><option>PE</option></select>
              <input type="number" min="1" value={leg.lots} onChange={e=>updateLeg(i,{lots:Math.max(1,+e.target.value||1)})}/>
              <input type="number" step="0.05" value={leg.price} onChange={e=>updateLeg(i,{price:+e.target.value})}/>
            </div>)}
          </div>
          <div className="builder-strip">
            <div>Shift <button onClick={()=>shiftAll(-strikeStep)}>−</button><button onClick={()=>shiftAll(strikeStep)}>+</button></div>
            <div>Multiplier <input type="number" min="1" value={lotValue} onChange={e=>multiplyLots(+e.target.value)}/></div>
            <div className="premium-readout"><span>{summary.premium>=0?'Premium Receive':'Price Pay'}</span><b>{money(Math.abs(summary.premium))}</b></div>
          </div>
          <div className="builder-buttons"><button>Add/Edit</button><button>Add to Drafts</button><button disabled>Trade All</button></div>
        </div>
        <div className="panel ready-panel">
          <div className="ready-head"><b>Ready-made</b><span>Click a capped-loss template to load it</span><label>Expiry <select value={expiry} onChange={e=>setExpiry(e.target.value)}>{expiryOptions.map(x=><option key={x.expiry} value={x.expiry}>{x.label}</option>)}</select></label></div>
          <div className="strategy-ready">
            {report.candidates.map(candidate=><button type="button" key={candidate.name} onClick={()=>chooseCandidate(candidate)}><StrategyMini name={candidate.name} active={candidate.name===selected.name}/></button>)}
          </div>
        </div>
      </div>
      <div className="strategy-right">
        <div className="panel sensi-summary">
          <div><span>Max Profit</span><b className="green">{money(summary.maxProfit)}</b></div>
          <div><span>Max Loss <InfoTip text="Maximum estimated loss at expiry across the displayed price grid. It is shown as a negative number because it is money at risk, and all candidate strategies are filtered to avoid unlimited loss."/></span><b className="red">{money(-summary.maxLoss)}</b></div>
          <div><span>Breakeven</span><b>{summary.breakevens.length ? summary.breakevens.map(num).join(', ') : '—'}</b></div>
          <div><span>Reward / Risk</span><b>{summary.riskReward?`${summary.riskReward.toFixed(2)}x`:'—'}</b></div>
          <div><span>POP</span><b>{pct(summary.probabilityProfit)}</b></div>
          <div><span>Funds & Margins</span><b>{money(summary.margin)}</b></div>
        </div>
        <div className="panel payoff-panel sensi-card">
          <PanelTitle label="Suggested strategy payoff" note={`${selected.name} · ${expiryOptions.find(x=>x.expiry===expiry)?.label || report.expiry}`} help="Sensibull-style payoff workspace for the current suggested/edited strategy. Green/red bars are open-interest concentration from the stored Nifty options chain; payoff lines update with the selected expiry, strikes, option type, lot count and entry prices."/>
          <div className="payoff-tabs">
            {(['graph','pl','greeks','chart'] as const).map(item=><button className={tab===item?'active':''} onClick={()=>setTab(item)} key={item}>{item==='graph'?'Payoff Graph':item==='pl'?'P&L Table':item==='greeks'?'Greeks':'Strategy Chart'}</button>)}
            <label className="booked-toggle"><input type="checkbox" checked readOnly/> Add Booked P&L</label>
          </div>
          {tab==='graph' && <StrategyPayoffGraph data={chartData} report={report} selected={selected} summary={summary}/>}
          {tab==='pl' && <StrategyPLTable legs={activeLegs} report={report}/>}
          {tab==='greeks' && <StrategyGreeks legs={activeLegs} report={report}/>}
          {tab==='chart' && <StrategyPriceChart data={chartData}/>}
          <div className="strategy-lower">
            <div><b>Strikewise IVs</b>{activeLegs.map((leg,i)=><p key={i}>{num(leg.strike)} {leg.type} · {expiryLabel(leg.expiry, expiryOptions)} · IV {(report.prediction?.india_vix||14).toFixed(1)}%</p>)}</div>
            <div><b>Target Day Futures Prices</b><p>{expiryLabel(report.expiry, expiryOptions)} FUT {num(report.spot*(1+(report.prediction?.expected_return||0)))}</p><p>1 SD {num(report.prediction?.expected_lower_range||0)} / {num(report.prediction?.expected_upper_range||0)}</p></div>
          </div>
        </div>
      </div>
    </section>
    <section className="strategy-grid">
      <div className="panel strategy-metrics">
        <PanelTitle label="Why this strategy won" note="Reward, risk, probability and expected value" help="The chosen strategy is the highest ranked capped-loss candidate after combining expected P/L per lot, probability of profit, reward/risk and directional alignment with the model forecast."/>
        <div className="strategy-kpis">
          <div><span>Max profit</span><b className="green">{money(summary.maxProfit)}</b></div>
          <div><span>Max loss</span><b className="red">{money(-summary.maxLoss)}</b></div>
          <div><span>Reward / risk</span><b>{summary.riskReward ? `${summary.riskReward.toFixed(2)}x` : '—'}</b></div>
          <div><span>Probability profit</span><b>{pct(summary.probabilityProfit)}</b></div>
          <div><span>Expected P/L</span><b className={summary.expectedProfit>=0?'green':'red'}>{money(summary.expectedProfit)}</b></div>
          <div><span>{summary.premium>=0?'Credit received':'Debit paid'}</span><b>{money(Math.abs(summary.premium))}</b></div>
        </div>
        <div className="rationale"><b>Reasoning</b><p>{selected.rationale}</p><p>{selected.interpretation}</p><p>Breakeven: {summary.breakevens.length?summary.breakevens.map(num).join(', '):'Not inside displayed range'}.</p>{loading&&<p>Refreshing expiry data…</p>}</div>
      </div>
      <div className="panel selected-strategy">
        <div><span>Selected strategy</span><h2>{selected.name}</h2><p>{selected.interpretation}</p></div>
        <div className={`strategy-chip ${selected.family.toLowerCase()}`}>{selected.family}</div>
      </div>
    </section>
    <section className="two-col">
      <div className="panel table-panel"><PanelTitle label="Strategy comparison" note="Capped-loss candidates ranked by score" help="Compares the shortlisted defined-risk strategies. Max loss is shown negative because it is the amount at risk. The final choice is not simply the largest payoff; it balances max loss, probability of profit, expected value and model direction."/><Table columns={['strategy','family','pop','expected_pl','max_profit','max_loss','rr']} rows={comparison}/></div>
      <div className="panel table-panel"><PanelTitle label="Past results of suggested strategy" note="Last 14 replay observations" help="Historical replay uses prior saved predictions and actual next-day Nifty closes. When exact historical option premiums are unavailable, results are estimated with a consistent proxy spread model and should be read directionally."/><Table columns={['date','suggested','prob_up','nifty_return','estimated_pl','outcome']} rows={history}/></div>
    </section>
    <Disclaimer/>
  </>
}

function StrategyPayoffGraph({data,report,selected,summary}:{data:any[];report:StrategyReport;selected:StrategyCandidate;summary:any}) {
  return <div className="strategy-chart-wrap">
    <div className="oi-legend"><span>OI data at {num(nearestStrike(report.spot, report.option_chain))}</span><i className="call"/> Call OI <b>{oiTotal(report.oi_bars,'call_oi')}</b><i className="put"/> Put OI <b>{oiTotal(report.oi_bars,'put_oi')}</b><em>— On Expiry</em><em className="blue">— On Target Date</em></div>
    <ResponsiveContainer width="100%" height={390}><ComposedChart data={data}><CartesianGrid stroke="#d9e1df22" vertical={false}/><XAxis dataKey="spot" tickFormatter={num} stroke="#66807a"/><YAxis yAxisId="pl" tickFormatter={moneyShort} stroke="#66807a" label={{value:'Profit / loss',angle:-90,position:'insideLeft'}}/><YAxis yAxisId="oi" orientation="right" tickFormatter={(v)=>`${Number(v).toFixed(0)}L`} stroke="#66807a" label={{value:'Open Interest',angle:90,position:'insideRight'}}/><Tooltip content={<StrategyTooltip/>}/><ReferenceLine yAxisId="pl" y={0} stroke="#829992"/><ReferenceLine yAxisId="pl" x={report.spot} stroke="#dce9e5" label="Current price"/><ReferenceLine yAxisId="pl" x={report.prediction?.expected_lower_range} stroke="#f06a69" strokeDasharray="4 4" label="-1SD"/><ReferenceLine yAxisId="pl" x={report.prediction?.expected_upper_range} stroke="#51e6a6" strokeDasharray="4 4" label="1SD"/><Bar yAxisId="oi" dataKey="put_oi_lakh" name="Put OI" fill="#a7eab2" opacity={0.45}/><Bar yAxisId="oi" dataKey="call_oi_lakh" name="Call OI" fill="#f3a6a2" opacity={0.45}/><Line yAxisId="pl" dataKey="expiry_pl" name="On Expiry" stroke="#16a36f" strokeWidth={2.4} dot={false}/><Line yAxisId="pl" dataKey="target_pl" name="On Target Date" stroke="#0b75df" strokeWidth={2.4} dot={false}/></ComposedChart></ResponsiveContainer>
    <div className="target-pill">Projected P/L at model target: {money(summary.expectedProfit)} · {selected.name}</div>
  </div>
}

function StrategyTooltip({active,payload,label}:any) {
  if(!active || !payload?.length) return null
  const row=payload[0]?.payload || {}
  return <div className="strategy-tooltip"><span>When price is at</span><b>{num(Number(label))}</b><hr/><p>Expiry P/L <strong>{money(row.expiry_pl||0)}</strong></p><p>Target-day P/L <strong>{money(row.target_pl||0)}</strong></p>{(row.call_oi_lakh||row.put_oi_lakh) ? <p>OI bars <strong>CE {row.call_oi_lakh?.toFixed?.(1)||0}L · PE {row.put_oi_lakh?.toFixed?.(1)||0}L</strong></p> : null}</div>
}

function StrategyPLTable({legs,report}:{legs:StrategyLeg[];report:StrategyReport}) {
  const target=report.spot*(1+(report.prediction?.expected_return||0))
  const rows=legs.map(leg=>{
    const entry=leg.price*report.lot_size*leg.lots
    const targetValue=optionIntrinsic(leg,target)*report.lot_size*leg.lots
    const targetPl=leg.action==='BUY'?targetValue-entry:entry-targetValue
    return {instrument:`${leg.action[0]} ${leg.lots} x ${expiryLabel(leg.expiry,report.expiries)} ${num(leg.strike)} ${leg.type}`, target_pl:targetPl, target_price:optionIntrinsic(leg,target), entry_price:leg.price, ltp:leg.price}
  })
  const total=rows.reduce((a,r)=>a+r.target_pl,0)
  return <div className="strategy-table-block"><Table columns={['instrument','target_pl','target_price','entry_price','ltp']} rows={[...rows,{instrument:'Total projected',target_pl:total,target_price:null,entry_price:null,ltp:null}]}/></div>
}

function StrategyGreeks({legs,report}:{legs:StrategyLeg[];report:StrategyReport}) {
  const rows=legs.map(leg=>{
    const sign=leg.action==='BUY'?1:-1
    const moneyness=(report.spot-leg.strike)/(report.spot*0.012)
    const callDelta=1/(1+Math.exp(-moneyness))
    const rawDelta=leg.type==='CE'?callDelta:callDelta-1
    return {instrument:`${leg.action[0]} ${leg.lots} x ${num(leg.strike)} ${leg.type}`, delta:sign*rawDelta*leg.lots, theta:sign*-leg.price*.04*leg.lots, decay:sign*-leg.price*.18*leg.lots, gamma:sign*.0001*leg.lots, vega:sign*leg.price*.06*leg.lots}
  })
  const total=(key:keyof typeof rows[number])=>rows.reduce((a,r)=>a+Number(r[key]||0),0)
  return <div className="strategy-table-block"><Table columns={['instrument','delta','theta','decay','gamma','vega']} rows={[...rows,{instrument:'Total approx.',delta:total('delta'),theta:total('theta'),decay:total('decay'),gamma:total('gamma'),vega:total('vega')}]}/></div>
}

function StrategyPriceChart({data}:{data:any[]}) {
  return <ResponsiveContainer width="100%" height={350}><LineChart data={data}><CartesianGrid stroke="#d9e1df22" vertical={false}/><XAxis dataKey="spot" tickFormatter={num} stroke="#66807a"/><YAxis tickFormatter={moneyShort} stroke="#66807a"/><Tooltip contentStyle={tip} formatter={(v:any)=>money(Number(v))}/><Line dataKey="target_pl" name="Strategy Price / Target P&L" stroke="#0b75df" strokeWidth={2} dot={false}/><Line dataKey="expiry_pl" name="Expiry P&L" stroke="#16a36f" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer>
}

function StrategyMini({name,active}:{name:string;active:boolean}) {
  const paths=strategyIconPaths(name)
  return <div className={active?'strategy-mini active':'strategy-mini'}><svg viewBox="0 0 80 48"><path d="M8 34 H72" stroke="#b8c7c3" strokeDasharray="4 4"/>{paths.map((p,i)=><path key={i} d={p.d} fill="none" stroke={p.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>)}</svg><span>{name}</span></div>
}

function strategyIconPaths(name:string) {
  const green='#16a36f', red='#f06a69'
  const map:Record<string,{d:string;color:string}[]>={
    'Bull Call Spread':[{d:'M8 36 L30 36',color:red},{d:'M30 36 L52 14',color:green},{d:'M52 14 L72 14',color:green}],
    'Bull Put Spread':[{d:'M8 36 L28 36',color:red},{d:'M28 36 L44 22',color:green},{d:'M44 22 L72 22',color:green}],
    'Bear Put Spread':[{d:'M8 14 L30 14',color:green},{d:'M30 14 L52 36',color:red},{d:'M52 36 L72 36',color:red}],
    'Bear Call Spread':[{d:'M8 22 L36 22',color:green},{d:'M36 22 L52 36',color:red},{d:'M52 36 L72 36',color:red}],
    'Iron Condor':[{d:'M8 36 L24 36',color:red},{d:'M24 36 L34 20',color:green},{d:'M34 20 L48 20',color:green},{d:'M48 20 L58 36',color:red},{d:'M58 36 L72 36',color:red}],
    'Iron Butterfly':[{d:'M8 36 L30 36',color:red},{d:'M30 36 L40 10',color:green},{d:'M40 10 L50 36',color:red},{d:'M50 36 L72 36',color:red}],
    'Long Straddle':[{d:'M8 36 L40 10',color:green},{d:'M40 10 L72 36',color:green}],
    'Long Strangle':[{d:'M8 36 L28 36',color:red},{d:'M28 36 L40 16',color:green},{d:'M40 16 L52 36',color:red},{d:'M52 36 L72 36',color:red}],
  }
  return map[name] || [{d:'M8 34 L35 34 L72 15',color:green}]
}

function cloneLegs(legs:StrategyLeg[]){return legs.map(leg=>({...leg}))}
function strategyPayoff(legs:StrategyLeg[],spot:number,lotSize:number){return legs.reduce((total,leg)=>{const intrinsic=optionIntrinsic(leg,spot);const one=leg.action==='BUY'?intrinsic-leg.price:leg.price-intrinsic;return total+one*lotSize*(leg.lots||1)},0)}
function optionIntrinsic(leg:StrategyLeg,spot:number){return leg.type==='CE'?Math.max(spot-leg.strike,0):Math.max(leg.strike-spot,0)}
function buildStrategyPayoff(report:StrategyReport,legs:StrategyLeg[]){
  const spot=report.spot, p=report.prediction
  const band=p ? Math.abs(p.expected_upper_range-p.expected_lower_range)/2 : spot*.012
  const vixBand=spot*((p?.india_vix||14)/100/Math.sqrt(365))
  const sd=Math.max(band,vixBand,spot*.006)
  const low=Math.max(1,spot-3*sd), high=spot+3*sd
  const points=Array.from({length:121},(_,i)=>{const x=low+(high-low)*i/120;const expiryPl=strategyPayoff(legs,x,report.lot_size);return {spot:x,expiry_pl:expiryPl,target_pl:expiryPl*.65,expected_lower:p?.expected_lower_range,expected_upper:p?.expected_upper_range,current_spot:spot}})
  return {points}
}
function summarizeStrategy(report:StrategyReport,selected:StrategyCandidate,legs:StrategyLeg[],payoff:{points:any[]}){
  const vals=payoff.points.map(p=>p.expiry_pl)
  const maxProfit=Math.max(...vals), maxLoss=Math.abs(Math.min(...vals))
  const target=report.spot*(1+(report.prediction?.expected_return||0))
  const expectedProfit=nearestPoint(payoff.points,target)?.target_pl ?? selected.expected_profit
  const probabilityProfit=vals.filter(v=>v>0).length/Math.max(vals.length,1)
  const premium=legs.reduce((sum,leg)=>sum+(leg.action==='SELL'?1:-1)*leg.price*report.lot_size*(leg.lots||1),0)
  const breakevens=breakevensFromPoints(payoff.points)
  return {maxProfit,maxLoss,expectedProfit,probabilityProfit,premium,breakevens,riskReward:maxLoss?maxProfit/maxLoss:0,margin:maxLoss+Math.max(0,-premium)}
}
function breakevensFromPoints(points:any[]){const out:number[]=[];for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];if(a.expiry_pl===0)out.push(a.spot);else if(a.expiry_pl*b.expiry_pl<0)out.push(a.spot+(0-a.expiry_pl)*(b.spot-a.spot)/(b.expiry_pl-a.expiry_pl))}return out.slice(0,4)}
function nearestPoint(points:any[],spot:number){return points.reduce((best,item)=>Math.abs(item.spot-spot)<Math.abs(best.spot-spot)?item:best,points[0])}
function attachOiBars(points:any[],bars:StrategyReport['oi_bars']){const enriched=points.map(p=>({...p,call_oi_lakh:0,put_oi_lakh:0}));(bars||[]).forEach(bar=>{let idx=0;for(let i=1;i<enriched.length;i++)if(Math.abs(enriched[i].spot-bar.strike)<Math.abs(enriched[idx].spot-bar.strike))idx=i;enriched[idx].call_oi_lakh=bar.call_oi_lakh;enriched[idx].put_oi_lakh=bar.put_oi_lakh});return enriched}
function marketPrice(report:StrategyReport,leg:StrategyLeg){const row=report.option_chain?.find(item=>Math.abs(item.strike-leg.strike)<1e-6);if(!row)return null;return leg.type==='CE'?row.ce_ltp:row.pe_ltp}
function strikeStepFromChain(chain:StrategyReport['option_chain']){const strikes=[...(chain||[]).map(x=>x.strike)].sort((a,b)=>a-b);const diffs=strikes.slice(1).map((x,i)=>x-strikes[i]).filter(x=>x>0);return diffs.length?Math.min(...diffs):50}
function nearestStrike(spot:number,chain:StrategyReport['option_chain']){const strikes=(chain||[]).map(x=>x.strike);return strikes.length?strikes.reduce((a,b)=>Math.abs(b-spot)<Math.abs(a-spot)?b:a,strikes[0]):spot}
function oiTotal(bars:StrategyReport['oi_bars'],key:'call_oi'|'put_oi'){const total=(bars||[]).reduce((a,b)=>a+Number(b[key]||0),0);return total>=10000000?`${(total/10000000).toFixed(2)}Cr`:`${(total/100000).toFixed(2)}L`}
function expiryLabel(expiry:string,options?:{expiry:string;label:string}[]){return options?.find(x=>x.expiry===expiry)?.label?.replace(/\s+\(.+\)/,'') || expiry}

function StrategyTomorrowOld() {
  const [report,setReport]=useState<StrategyReport|null>(null)
  const [error,setError]=useState('')
  useEffect(()=>{api<StrategyReport>('/api/strategy/tomorrow').then(setReport).catch(e=>setError((e as Error).message))},[])
  if (error) return <div className="panel"><Empty text={error}/></div>
  if (!report) return <div className="panel"><Empty text="Ranking capped-risk strategies from the latest model forecast and option chain…"/></div>
  if (report.status !== 'complete') return <div className="panel"><Empty text={report.warning || 'Strategy engine is waiting for prediction and options-chain data.'}/></div>
  const selected=report.selected
  const comparison=report.candidates.map(c=>({strategy:c.name, family:c.family, pop:c.probability_profit, expected_pl:c.expected_profit, max_profit:c.max_profit, max_loss:c.max_loss, rr:c.risk_reward ?? 0}))
  const history=report.history.map(h=>({date:h.date, suggested:h.strategy, prob_up:h.probability_up, nifty_return:h.nifty_return, estimated_pl:h.estimated_pl, outcome:h.outcome}))
  return <>
    <section className="strategy-grid">
      <div className="panel strategy-ticket">
        <PanelTitle label="Strategy for tomorrow" note={`${report.next_trading_day} · nearest expiry ${report.expiry}`} help="The engine ranks only capped-loss Nifty option strategies. It uses the latest probability forecast, expected range, option premiums, probability of profit, expected value and reward/risk. Unlimited-loss structures are excluded."/>
        <div className="strategy-search"><span>NIFTY</span><b>{num(report.spot)}</b><em>{report.prediction?.signal}</em></div>
        <div className="selected-strategy">
          <div><span>Selected strategy</span><h2>{selected.name}</h2><p>{selected.interpretation}</p></div>
          <div className={`strategy-chip ${selected.family.toLowerCase()}`}>{selected.family}</div>
        </div>
        <div className="legs-table">
          <div className="legs-head"><span>B/S</span><span>Expiry</span><span>Strike</span><span>Type</span><span>Lots</span><span>Price</span></div>
          {selected.legs.map((leg,i)=><div className="leg-row" key={i}><b className={leg.action==='BUY'?'buy':'sell'}>{leg.action[0]}</b><span>{leg.expiry}</span><span>{num(leg.strike)}</span><span>{leg.type}</span><span>{leg.lots}</span><span>{leg.price.toFixed(2)}</span></div>)}
        </div>
        <div className="strategy-ready">
          {['Bull Call Spread','Bull Put Spread','Bear Put Spread','Bear Call Spread','Iron Condor','Iron Butterfly','Long Straddle','Long Strangle'].map(name=><StrategyMini key={name} name={name} active={name===selected.name}/>)}
        </div>
      </div>
      <div className="panel strategy-metrics">
        <PanelTitle label="Why this strategy won" note="Reward, risk, probability and expected value" help="The chosen strategy is the highest ranked capped-loss candidate after combining expected P/L per lot, probability of profit, reward/risk and directional alignment with the model forecast."/>
        <div className="strategy-kpis">
          <div><span>Max profit</span><b className="green">{money(selected.max_profit)}</b></div>
          <div><span>Max loss</span><b className="red">{money(-selected.max_loss)}</b></div>
          <div><span>Reward / risk</span><b>{selected.risk_reward ? `${selected.risk_reward.toFixed(2)}x` : 'Open'}</b></div>
          <div><span>Probability profit</span><b>{pct(selected.probability_profit)}</b></div>
          <div><span>Expected P/L</span><b className={selected.expected_profit>=0?'green':'red'}>{money(selected.expected_profit)}</b></div>
          <div><span>{selected.premium_label}</span><b>{money(Math.abs(selected.premium))}</b></div>
        </div>
        <div className="rationale"><b>Reasoning</b><p>{selected.rationale}</p><p>Breakeven: {selected.breakevens.length?selected.breakevens.map(num).join(', '):'Not inside displayed range'}.</p></div>
      </div>
    </section>
    <section className="panel payoff-panel">
      <PanelTitle label="Payoff graph" note="On-expiry and target-day P/L per lot" help="The green/red payoff line shows estimated expiry P/L across possible Nifty levels. The blue line is a conservative target-day approximation. Vertical markers show current spot and model expected range."/>
      <ResponsiveContainer width="100%" height={360}><LineChart data={report.payoff_points}><CartesianGrid stroke="#d9e1df22" vertical={false}/><XAxis dataKey="spot" tickFormatter={num} stroke="#66807a"/><YAxis tickFormatter={moneyShort} stroke="#66807a"/><Tooltip contentStyle={tip} formatter={(v:any)=>money(Number(v))} labelFormatter={(v)=>`Nifty ${num(Number(v))}`}/><ReferenceLine y={0} stroke="#829992"/><ReferenceLine x={report.spot} stroke="#dce9e5" label="Spot"/><ReferenceLine x={report.prediction?.expected_lower_range} stroke="#f06a69" strokeDasharray="4 4" label="Lower"/><ReferenceLine x={report.prediction?.expected_upper_range} stroke="#51e6a6" strokeDasharray="4 4" label="Upper"/><Line dataKey="expiry_pl" name="On Expiry" stroke="#16a36f" strokeWidth={2} dot={false}/><Line dataKey="target_pl" name="On Target Date" stroke="#0b75df" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer>
    </section>
    <section className="two-col">
      <div className="panel table-panel"><PanelTitle label="Strategy comparison" note="Capped-loss candidates ranked by score" help="Compares the shortlisted defined-risk strategies. The final choice is not simply the largest payoff; it balances max loss, probability of profit, expected value and model direction."/><Table columns={['strategy','family','pop','expected_pl','max_profit','max_loss','rr']} rows={comparison}/></div>
      <div className="panel table-panel"><PanelTitle label="Past results of suggested strategy" note="Replay of what would have been suggested earlier" help="Historical replay uses prior saved predictions and actual next-day Nifty closes. When exact historical option premiums are unavailable, results are estimated with a consistent proxy spread model and should be read directionally."/><Table columns={['date','suggested','prob_up','nifty_return','estimated_pl','outcome']} rows={history}/></div>
    </section>
    <Disclaimer/>
  </>
}

function StrategyMiniOld({name,active}:{name:string;active:boolean}) {
  const isBear=name.toLowerCase().includes('bear'), isVol=name.toLowerCase().includes('straddle')||name.toLowerCase().includes('strangle')
  return <div className={active?'strategy-mini active':'strategy-mini'}><svg viewBox="0 0 80 48"><path d={isVol?'M8 34 L25 34 L40 12 L55 34 L72 34':isBear?'M8 12 L34 32 L72 32':'M8 34 L34 34 L72 12'} fill="none" stroke={isBear?'#f06a69':'#16a36f'} strokeWidth="3"/><path d="M8 34 H72" stroke="#b8c7c3" strokeDasharray="4 4"/></svg><span>{name}</span></div>
}

function BacktestPage({data}:{data:Backtest|null}) {
  return <>{!data ? <div className="panel"><Empty text="Run model training to generate a walk-forward backtest."/></div> : <>
    <section className="kpi-row"><Kpi label="Accuracy" value={pct(Number(data.metrics.accuracy))} sub="Out of sample" help="Share of walk-forward days where the model's probability crossed 50% in the correct direction. Useful but incomplete because it ignores confidence and probability calibration."/><Kpi label="Balanced accuracy" value={pct(Number(data.metrics.balanced_accuracy))} sub="Class adjusted" help="Average of up-day accuracy and down-day accuracy. This prevents the score from looking good merely because one class, such as up days, occurs more often."/><Kpi label="Return MAE" value={pct(Number(data.metrics.mae_return))} sub="Regression error" help="Mean absolute error of the expected-return model. This is used in the expected-range calculation as a cushion for typical forecast error."/><Kpi label="Log loss" value={Number(data.metrics.log_loss).toFixed(3)} sub="Probability penalty" help="Probability scoring metric that heavily penalizes confident wrong forecasts. Lower log loss means the model is less reckless with high-conviction predictions."/></section>
    <section className="panel"><PanelTitle label="Nifty vs model strategy curve" note="Both curves normalized to Nifty price axis" help="The model strategy curve starts at the same Nifty price as the backtest and compounds the 55/45 signal returns after 3 bps costs. It is plotted against actual Nifty close on the same Y-axis, so relative performance is visually comparable in index points."/><ResponsiveContainer width="100%" height={360}><LineChart data={(data.price_curve?.length ? data.price_curve : data.equity_curve) as any[]}><CartesianGrid stroke="#1b302c" vertical={false}/><XAxis dataKey="date" hide/><YAxis stroke="#66807a" domain={['auto','auto']} tickFormatter={num}/><Tooltip contentStyle={tip} formatter={(v:any)=>num(Number(v))}/><Line dataKey="nifty_close" name="Actual Nifty 50" stroke="#8fb5ff" strokeWidth={2} dot={false}/><Line dataKey="model_strategy_close" name="Model strategy equivalent" stroke="#51e6a6" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></section>
    <section className="panel table-panel"><PanelTitle label="Threshold analysis" note="Expected value after transaction costs" help="Compares different probability cutoffs. Higher thresholds trade less often but require stronger model confidence; the table shows trade count, hit rate and total out-of-sample return after the assumed cost."/><Table columns={['threshold','trades','hit_rate','total_return']} rows={data.threshold_analysis}/></section>
  </>}</>
}

function Calibration({data}:{data:Backtest|null}) {
  const bars=data?.calibration||[]
  return <><section className="kpi-row"><Kpi label="Brier score" value={data?Number(data.metrics.brier_score).toFixed(3):'—'} sub="Ideal approaches 0" help="Mean squared probability error. A lower Brier score means the probabilities are closer to realized 0/1 outcomes across the backtest."/><Kpi label="Log loss" value={data?Number(data.metrics.log_loss).toFixed(3):'—'} sub="Confidence penalty" help="Penalizes overconfidence. A wrong 90% probability is far worse than a wrong 55% probability, so log loss helps detect reckless probability estimates."/><Kpi label="Calibration method" value="Platt" sub="Time-series folds" help="Platt calibration fits a sigmoid layer on top of the logistic classifier so raw scores map to observed frequencies more realistically."/><Kpi label="Buckets" value={String(bars.length||'—')} sub="Reliability bins" help="Number of probability intervals with enough out-of-sample observations to compare predicted probability against actual hit rate."/></section>
  <section className="panel"><PanelTitle label="Reliability by probability bucket" note="Observed frequency should track predicted probability" help="For each probability bucket, the dark bar is the model's average forecast and the green bar is the realized up-day frequency. Large gaps show underconfidence or overconfidence in that probability range." />{bars.length?<ResponsiveContainer width="100%" height={360}><BarChart data={bars}><CartesianGrid stroke="#1b302c" vertical={false}/><XAxis dataKey="bucket" stroke="#66807a"/><YAxis domain={[0,1]} tickFormatter={pct} stroke="#66807a"/><Tooltip contentStyle={tip}/><Bar dataKey="predicted" fill="#304842"/><Bar dataKey="actual" fill="#51e6a6"/></BarChart></ResponsiveContainer>:<Empty text="Calibration buckets appear after training."/>}</section></>
}

function Models({rows}:{rows:any[]}) {
  return <><section className="panel"><PanelTitle label="Model registry" note="Candidates, deployment gates and rollback history" help="Each row is a saved trained model artifact. Candidate models are trained but not live; eligible models passed gates; deployed is the one currently used for predictions; retired models remain available for audit/rollback." />{rows.length?<div className="model-list">{rows.map(r=><div className="model-row" key={r.version}><div className="model-icon"><BrainCircuit/></div><div><b>{r.version}</b><small>{r.algorithm} · {r.calibration_method}</small></div><div><span>ACCURACY</span><b>{pct(r.metrics.accuracy)}</b></div><div><span>BRIER</span><b>{Number(r.metrics.brier_score).toFixed(3)}</b></div><em className={`status ${r.status}`}>{r.status}</em></div>)}</div>:<Empty text="No model versions yet. Train the first candidate from Admin."/>}</section>
  <section className="panel"><PanelTitle label="Deployment policy" note="A model must earn promotion" help="Promotion rules prevent a newly trained model from becoming live just because training completed. It must beat a naive baseline, keep probability error under control, and have enough unseen test evidence."/><div className="gate-grid"><Gate text="Beats majority-class baseline" help="Accuracy must exceed a naive model that always predicts the historically more common class."/><Gate text="Brier score below 0.25" help="Probability error must be better than the rough score of an uninformative 50/50 forecast."/><Gate text="At least 252 out-of-sample observations" help="Requires roughly one trading year of walk-forward test observations before promotion."/><Gate text="Explicit force override is audited" help="A manual override can deploy a model that fails gates, but the action is explicit and visible rather than automatic."/></div></section></>
}

function Admin({onDone,models}:{onDone:()=>void;models:any[]}) {
  const [key,setKey]=useState(() => ['127.0.0.1','localhost'].includes(window.location.hostname) ? 'change-me' : ''); const [busy,setBusy]=useState(''); const [message,setMessage]=useState(''); const [dataset,setDataset]=useState('nifty')
  const action=async(name:string,path:string,body?:unknown)=>{setBusy(name);setMessage('');try{const result=await api<any>(path,{method:'POST',headers:{'X-Admin-Key':key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});setMessage(`${name} completed: ${result.model_version||result.rows_processed||result.status||'OK'}`);onDone()}catch(e){setMessage((e as Error).message)}finally{setBusy('')}}
  const upload=async(file:File)=>{setBusy('Upload');const form=new FormData();form.append('file',file);try{const result=await api<any>(`/api/admin/upload-csv?dataset=${dataset}`,{method:'POST',headers:{'X-Admin-Key':key},body:form});setMessage(`Imported ${result.rows} ${dataset} rows`);onDone()}catch(e){setMessage((e as Error).message)}finally{setBusy('')}}
  return <><section className="panel admin-head"><div><PanelTitle label="Pipeline control" note="Privileged actions require the server-side API key" help="Administrative actions mutate the local database or model registry. The key protects fetch/retrain/deploy/upload operations from accidental browser-side calls."/></div><label>ADMIN API KEY<input type="password" value={key} onChange={e=>setKey(e.target.value)} placeholder="Enter key"/></label></section>
  {message&&<div className="notice"><CheckCircle2 size={16}/>{message}</div>}
  <section className="action-grid"><Action icon={Database} title="Fetch market data" desc="Downloads/updates historical Yahoo series, overlays official NSE EOD Nifty and India VIX, and imports official FII/DII, participant OI and options bhavcopy where available." button="Fetch now" busy={busy==='Fetch'} onClick={()=>action('Fetch','/api/admin/fetch-data')}/><Action icon={BrainCircuit} title="Train candidate" desc="Rebuilds features, runs expanding-window walk-forward validation, calibrates the classifier, fits the final model, and stores a versioned artifact plus metrics." button="Retrain" busy={busy==='Retrain'} onClick={()=>action('Retrain','/api/admin/retrain-model')}/><Action icon={ShieldCheck} title="Deploy eligible model" desc="Promotes the newest eligible model to live status only after baseline, Brier score and sample-count gates pass." button="Deploy latest eligible" busy={busy==='Deploy'} onClick={()=>{const row=models.find(m=>m.status==='eligible');if(row)action('Deploy','/api/admin/deploy-model',{model_version:row.version});else setMessage('No eligible candidate is available.')}}/></section>
  <section className="panel upload-panel"><PanelTitle label="Manual CSV fallback" note="Validated, previewed and stored with manual_upload provenance" help="Use this when an online source is delayed or blocked. Uploaded rows are parsed, schema-checked, stored with manual_upload provenance, and then become available to the same feature-building and training pipeline."/><div className="upload-controls"><select value={dataset} onChange={e=>setDataset(e.target.value)}><option value="nifty">Nifty OHLC</option><option value="india_vix">India VIX</option><option value="fii_dii">FII / DII cash</option><option value="participant_oi">Participant OI</option><option value="options">Options chain EOD</option><option value="breadth">Market breadth</option><option value="global">Global market</option><option value="macro">Macro series</option></select><label className="upload-button"><Upload size={17}/>{busy==='Upload'?'Uploading…':'Choose CSV'}<input type="file" accept=".csv" onChange={e=>e.target.files?.[0]&&upload(e.target.files[0])}/></label></div></section></>
}

function MethodologyReport() {
  const sourceRows = [
    { dataset: 'Nifty 50 OHLC', source: 'Yahoo chart history + official NSE EOD overlay', timing: 'EOD close; official overlay after 15:30 IST', role: 'Target construction, trend, momentum, volatility, range and latest spot reference.' },
    { dataset: 'India VIX', source: 'Yahoo chart history + official NSE EOD overlay', timing: 'EOD volatility index', role: 'Implied-volatility regime, volatility shocks, percentile context and expected-move band.' },
    { dataset: 'Global markets', source: 'Yahoo chart endpoint', timing: 'Known before next Indian open', role: 'S&P 500, Nasdaq 100, Dow, Nikkei and Hang Seng risk-on/risk-off context.' },
    { dataset: 'Macro proxies', source: 'Yahoo chart endpoint', timing: 'Known before next Indian open', role: 'USDINR, DXY, Brent and US 10Y pressure score for FX, rates and commodity context.' },
    { dataset: 'FII / DII cash', source: 'Official NSE FII/DII endpoint', timing: 'After Indian close', role: 'Foreign/domestic institutional liquidity pressure, buy/sell ratios and rolling flow impulse.' },
    { dataset: 'Participant OI', source: 'Official NSE Clearing archive', timing: 'After F&O EOD publication', role: 'Client, DII, FII and Pro index futures/options positioning and positioning change.' },
    { dataset: 'Nifty options EOD', source: 'Official NSE FO UDiFF bhavcopy ZIP', timing: 'After F&O EOD publication', role: 'Nearest-expiry PCR, call wall, put wall, ATM straddle and strike concentration.' },
    { dataset: 'Manual CSV fallback', source: 'Admin upload', timing: 'User supplied; schema validated', role: 'Auditable fallback when official/public endpoints are delayed, blocked or revised.' },
  ]
  const featureRows = [
    { group: 'Return / trend', equations: 'R_n(t)=C_t/C_{t-n}-1; DMA gap=C_t/SMA_n(C)-1; slope=SMA_n(t)/SMA_n(t-5)-1' },
    { group: 'Candle structure', equations: 'Gap=O_t/C_{t-1}-1; intraday=C_t/O_t-1; CLV=(C_t-L_t)/(H_t-L_t); range=(H_t-L_t)/C_t' },
    { group: 'Momentum', equations: 'RSI_14 and RSI_5 from smoothed gains/losses; breakout=1{C_t above prior 20D high}; breakdown=1{C_t below prior 20D low}' },
    { group: 'Realized volatility', equations: 'sigma_n(t)=stdev(daily returns over n days) x sqrt(252), n in {5,10,20,60}' },
    { group: 'VIX state', equations: 'VIX return, z-score=(VIX_t-mean_20)/stdev_20, percentile_252, expected move=VIX/100/sqrt(365)' },
    { group: 'Institutional flows', equations: 'FII-DII spread=FII_net-DII_net; total net=FII_net+DII_net; buy/sell ratio=buy/sell; rolling sums over 3/5/10D' },
    { group: 'Global risk', equations: 'US composite=mean(S&P,Nasdaq,Dow returns); Asia composite=mean(Nikkei,Hang Seng); risk-on share=positive markets/markets' },
    { group: 'F&O positioning', equations: 'Index futures net=long-short; long/short ratio=long/short; call net=call long-call short; put net=put long-put short' },
    { group: 'Options structure', equations: 'PCR=total put OI/total call OI; call wall=argmax(call OI); put wall=argmax(put OI); ATM straddle=ATM CE LTP+ATM PE LTP' },
    { group: 'Calendar / expiry', equations: 'Day-of-week flags, weekly/monthly expiry flags, day-before/day-after expiry flags, days_to_expiry=(Thursday-current day) mod 7' },
  ]
  const metricRows = [
    { metric: 'Accuracy', equation: '(TP + TN) / N', meaning: 'Directional hit rate using 50% as the probability cutoff.' },
    { metric: 'Balanced accuracy', equation: '0.5 x [TP/(TP+FN) + TN/(TN+FP)]', meaning: 'Directional accuracy adjusted for up/down class imbalance.' },
    { metric: 'Brier score', equation: 'mean((p_t - y_t)^2)', meaning: 'Squared probability error; lower means better calibrated probabilities.' },
    { metric: 'Log loss', equation: '-mean(y_t log(p_t) + (1-y_t) log(1-p_t))', meaning: 'Penalizes overconfident wrong forecasts.' },
    { metric: 'MAE return', equation: 'mean(|r_t - r_hat_t|)', meaning: 'Average absolute return forecast error; used as range cushion.' },
    { metric: 'ROC-AUC', equation: 'P(score_positive > score_negative)', meaning: 'Ranking quality independent of a fixed cutoff.' },
  ]
  return <>
    <section className="panel method-hero">
      <PanelTitle label="How the model works" note="Financial methodology report for the Nifty next-session probability engine" help="This report documents the full research pipeline: data sources, timing controls, target definitions, feature equations, model mathematics, validation metrics, prediction logic, deployment gates and limitations."/>
      <p><b>Objective.</b> The system estimates the probability that the next Nifty 50 trading session closes higher than the latest verified Nifty close. It is an end-of-day probabilistic research model, not an intraday execution system and not a guarantee of direction or return.</p>
      <p><b>Primary outputs.</b> The dashboard reports P(up), P(down), expected next-session return, an indicative one-session range, regime classification, confidence, data quality, feature attribution and historical reliability evidence.</p>
      <div className="method-flow">
        <span>1. Fetch verified data</span><ChevronRight/><span>2. Align by availability</span><ChevronRight/><span>3. Engineer features</span><ChevronRight/><span>4. Walk-forward validate</span><ChevronRight/><span>5. Calibrate</span><ChevronRight/><span>6. Gate deployment</span><ChevronRight/><span>7. Predict next session</span>
      </div>
    </section>

    <section className="method-grid">
      <DocCard title="1. Forecast objective and horizon" help="Defines exactly what the model forecasts and what the probability means.">
        <p>The forecast is made after the latest verified close. The classifier estimates whether the next completed Nifty session closes above that close; the regressor separately estimates next-session return.</p>
        <Formula label="Latest close" value="C_t = verified Nifty 50 close on trading day t"/>
        <Formula label="Next-session return" value="r_{t+1} = C_{t+1}/C_t - 1"/>
        <Formula label="Direction label" value="y_t = 1{r_{t+1} > 0}; otherwise y_t = 0"/>
        <Formula label="Probability output" value="p_t = P(y_t = 1 | X_t), where X_t is information known for day t"/>
        <p>Interpretation: a 60% probability means similar historical states should resolve upward roughly 60 out of 100 times. It does not specify the size of the move.</p>
      </DocCard>

      <DocCard title="2. Data source discipline" help="Shows every major input, source, timing and role in the model.">
        <p>The model combines long history with official freshness. Yahoo chart history supplies long daily series; official NSE sources overwrite/extend freshness-critical Indian data for the latest trading date.</p>
        <Table columns={['dataset','source','timing','role']} rows={sourceRows}/>
        <p>Critical official feeds are date-checked. If a feed is delayed or unavailable, the dashboard reports Partial/Degraded data rather than silently manufacturing a complete-looking result.</p>
      </DocCard>

      <DocCard title="3. As-of timing and leakage controls" help="Explains how same-session look-ahead bias is avoided.">
        <p>Every stored row has a date and availability timestamp. The system only uses a feature if it would have been known before the relevant prediction cutoff. This is especially important for FII/DII flow, participant OI and options bhavcopy.</p>
        <Formula label="Availability rule" value="available_at(feature_i,t) <= prediction_cutoff_t"/>
        <Formula label="After-close rule" value="official cash/OI/options for day t are eligible for predicting day t+1"/>
        <Formula label="Walk-forward rule" value="train dates <= T_k; test dates are after T_k"/>
        <ul>
          <li>The latest row is used for live prediction but excluded from supervised training until its next-day label is known.</li>
          <li>One-day-only new feeds can appear on the dashboard, but do not enter training until they have enough history.</li>
          <li>Manual uploads keep source provenance and follow the same alignment rules.</li>
        </ul>
      </DocCard>

      <DocCard title="4. Feature library and financial intuition" help="Major signal groups and their formulas.">
        <p>The feature set is diversified across price action, volatility, institutional flow, derivatives positioning, options structure, global markets, macro proxies and calendar effects. The aim is to avoid dependence on one indicator family.</p>
        <Table columns={['group','equations']} rows={featureRows}/>
      </DocCard>

      <DocCard title="5. Preprocessing and eligibility" help="Explains missing values, scaling and which features are allowed into training.">
        <p>Only numeric columns can become model features. Raw identifiers, OHLC fields, source labels and availability timestamps are excluded from the feature set.</p>
        <Formula label="Minimum history" value="non_missing_count(feature_j) >= max(20, 5% of frame length)"/>
        <Formula label="Imputation" value="missing feature_j -> median(feature_j in training window) + missing indicator"/>
        <Formula label="Robust scaling" value="x_scaled = (x - median(x_train)) / IQR(x_train)"/>
        <p>Median imputation and robust scaling reduce the effect of source gaps, market shocks and outliers.</p>
      </DocCard>

      <DocCard title="6. Direction model: calibrated logistic regression" help="Probability model mathematics.">
        <p>The classifier is designed to be stable and auditable: median imputation, missing indicators, robust scaling, class-balanced logistic regression and Platt sigmoid calibration.</p>
        <Formula label="Linear score" value="z_t = beta_0 + beta' x_t"/>
        <Formula label="Raw probability" value="p_raw,t = 1 / (1 + exp(-z_t))"/>
        <Formula label="Weighted logistic loss" value="min_beta sum w_t log(1 + exp(-y*_t beta'x_t)) + lambda ||beta||^2"/>
        <Formula label="Platt calibration" value="p_t = 1 / (1 + exp(A x score_t + B))"/>
        <Formula label="Configured classifier" value="C=0.25, class_weight=balanced, solver=liblinear, max_iter=2000"/>
        <p>Calibration is crucial because the output is used as a probability scale, not just a directional score.</p>
      </DocCard>

      <DocCard title="7. Expected return model: Ridge regression" help="Expected-return model and its use in the dashboard.">
        <p>A separate Ridge regression estimates next-session return. It supports the expected-return display, signal labeling and range calculation.</p>
        <Formula label="Return forecast" value="r_hat,t+1 = alpha_0 + theta' x_t"/>
        <Formula label="Ridge objective" value="min_theta sum (r_{t+1} - r_hat,t+1)^2 + lambda ||theta||^2"/>
        <Formula label="Configured alpha" value="lambda = 8.0"/>
        <p>Ridge regularization shrinks unstable coefficients, which is helpful because market features are often correlated.</p>
      </DocCard>

      <DocCard title="8. Walk-forward validation design" help="How the backtest mimics real-time use.">
        <p>The backtest uses an expanding-window walk-forward process. Each fold trains on prior data, predicts the next block, stores predictions, then expands the training window.</p>
        <Formula label="Initial train window" value="756 trading rows, about three market years"/>
        <Formula label="Test block" value="63 trading rows, about one quarter"/>
        <Formula label="Fold k train set" value="{1, ..., T_k}"/>
        <Formula label="Fold k test set" value="{T_k+1, ..., min(T_k+63, N)}"/>
        <Formula label="No future refit" value="model_k is frozen during its test block"/>
      </DocCard>

      <DocCard title="9. Evaluation metrics" help="Defines every major score used for monitoring and deployment.">
        <Table columns={['metric','equation','meaning']} rows={metricRows}/>
        <p>Accuracy measures direction. Brier score and log loss measure probability quality. ROC-AUC measures ranking quality. Deployment considers more than one metric because a model can be directionally decent but badly calibrated.</p>
      </DocCard>

      <DocCard title="10. Calibration and reliability" help="How the reliability chart should be read.">
        <p>Out-of-sample predictions are grouped into probability buckets. Within each bucket, the app compares average forecast probability against realized up-day frequency.</p>
        <Formula label="Bucket forecast" value="p_bar,b = mean(p_t for observations in bucket b)"/>
        <Formula label="Bucket hit rate" value="hit_b = mean(y_t for observations in bucket b)"/>
        <Formula label="Ideal calibration" value="hit_b approximately equals p_bar,b across buckets"/>
        <p>If the 60-70% bucket realizes only 50%, the model is overconfident there. If it realizes 75%, the model is underconfident there.</p>
      </DocCard>

      <DocCard title="11. Expected range calculation" help="All equations behind the lower and upper range.">
        <p>The range blends expected return, historical forecast error and volatility-implied movement. It is an indicative risk envelope around the latest close.</p>
        <Formula label="Realized daily move" value="m_hist = realized_vol_20d / sqrt(252)"/>
        <Formula label="VIX daily move" value="m_vix = IndiaVIX / 100 / sqrt(365)"/>
        <Formula label="Model error cushion" value="m_model = |r_hat| + MAE_return"/>
        <Formula label="Blended vol move" value="m_vol = (m_hist + m_vix) / 2"/>
        <Formula label="Final move" value="m = max(m_model, m_vol)"/>
        <Formula label="Range" value="Lower = C_t x (1 - m); Upper = C_t x (1 + m)"/>
        <p>The range is not a support/resistance guarantee; it is a probability-informed volatility band.</p>
      </DocCard>

      <DocCard title="12. Signal labels and confidence" help="How probability becomes dashboard language.">
        <p>The label is a readable summary of the probability and expected-return context. It never replaces the numeric probability.</p>
        <Formula label="Strong bearish" value="p_t < 0.40"/>
        <Formula label="Mild bearish" value="0.40 <= p_t < 0.475"/>
        <Formula label="Neutral" value="0.475 <= p_t <= 0.525, or expected return fails cost filter near 50%"/>
        <Formula label="Mild bullish" value="0.525 < p_t < 0.60"/>
        <Formula label="Strong bullish" value="p_t >= 0.60"/>
        <Formula label="Confidence" value="High if |p_t-0.50| >= 0.15 and completeness >= 0.90; Medium if edge >= 0.075; otherwise Low"/>
      </DocCard>

      <DocCard title="13. Data quality and deployment gates" help="Why models/data can be Complete, Partial, Degraded, Unsafe, candidate, eligible or deployed.">
        <Formula label="Completeness" value="q_t = non_missing_required_features / required_features"/>
        <Formula label="Quality bands" value="Complete >= 90%; Partial >= 75%; Degraded >= 55%; Unsafe < 55%"/>
        <Formula label="Gate 1" value="walk-forward accuracy > majority-class baseline"/>
        <Formula label="Gate 2" value="Brier score < 0.25"/>
        <Formula label="Gate 3" value="out-of-sample observations >= 252"/>
        <p>A trained model becomes live only after it passes these gates, unless an explicit force override is used.</p>
      </DocCard>

      <DocCard title="14. Feature attribution" help="How bullish and bearish drivers are calculated.">
        <p>Driver lists are local explanations for today's row. They are not universal causal claims.</p>
        <Formula label="Base probability" value="p_base = model(X_latest)"/>
        <Formula label="Perturbed probability" value="p_without_j = model(X_latest with feature j set missing)"/>
        <Formula label="Impact" value="impact_j = p_base - p_without_j"/>
        <p>Positive impact means the feature supports the up-probability today; negative impact means it pulls the forecast lower.</p>
      </DocCard>

      <DocCard title="15. Assumptions and limitations" help="Research caveats that keep the output from being over-interpreted.">
        <ul>
          <li>The model cannot foresee overnight news, policy shocks, geopolitical events, liquidity accidents or exchange rule changes.</li>
          <li>Walk-forward results are out-of-sample but still historical; market relationships can decay.</li>
          <li>Official data may be delayed or revised. Data quality badges are part of the decision, not decoration.</li>
          <li>Options bhavcopy is official EOD data, but implied volatility fields are not always present and are not fabricated.</li>
          <li>Transaction costs are simplified; live trading would also face spreads, slippage, taxes, impact and instrument constraints.</li>
          <li>Use the output as structured research support: combine probability, confidence, range, calibration and drivers before forming an independent view.</li>
        </ul>
      </DocCard>
    </section>
    <Disclaimer/>
  </>
}

function Methodology() {
  const sourceRows = [
    { dataset: 'Nifty 50 OHLC', source: 'Yahoo chart history + official NSE EOD overlay', use: 'Core target, price action, trend, volatility and latest close.' },
    { dataset: 'India VIX', source: 'Yahoo chart history + official NSE EOD overlay', use: 'Volatility state and expected range calculation.' },
    { dataset: 'Global / macro markets', source: 'Yahoo chart endpoint', use: 'US, Asia, USDINR, DXY, Brent and US 10Y risk context available before the next Nifty open.' },
    { dataset: 'FII / DII cash flow', source: 'Official NSE FII/DII endpoint', use: 'Institutional buying/selling pressure after the Indian close.' },
    { dataset: 'F&O participant OI', source: 'Official NSE Clearing participant OI archive', use: 'Client, DII, FII and Pro index futures/options positioning.' },
    { dataset: 'Nifty options EOD', source: 'Official NSE FO UDiFF bhavcopy ZIP', use: 'PCR, OI walls, ATM straddle and nearest-expiry structure. IV stays blank when bhavcopy does not publish it.' },
    { dataset: 'Manual CSV fallback', source: 'Admin upload', use: 'Auditable fallback when a source is delayed or blocked; stored with manual_upload provenance.' },
  ]
  const featureRows = [
    { group: 'Price / trend', examples: '1-20 day returns, gap %, intraday return, high-low range, close location, DMA distances/slopes, RSI, ATR, breakouts.' },
    { group: 'Volatility', examples: 'Realized volatility over 5/10/20/60 days, VIX returns, VIX z-scores, VIX percentile, expected daily move.' },
    { group: 'Institutional flow', examples: 'FII-DII spread, total institution net, buy/sell ratios, rolling 3/5/10 day sums, z-scores and absorption flags.' },
    { group: 'Global risk', examples: 'US and Asia composite returns, risk-on / risk-off score, macro pressure score from USDINR, DXY, Brent and US10Y.' },
    { group: 'Derivatives', examples: 'Participant index futures net, long/short ratio, call/put net positions, put-call positioning ratio and net changes.' },
    { group: 'Options', examples: 'Nearest expiry, ATM strike, PCR by OI, call wall, put wall, wall distance, ATM straddle price and IV skew when IV is available.' },
    { group: 'Calendar', examples: 'Day-of-week flags, Monday/Friday flags, weekly/monthly expiry flags and days to expiry.' },
  ]
  return <>
    <section className="panel method-hero">
      <PanelTitle label="How the model works" note="End-to-end audit trail for the Nifty next-session probability engine" help="This page explains the full pipeline from source data to probability, range, confidence, and deployment decisions."/>
      <p>The app is built as an end-of-day research terminal. It estimates the probability that the next Nifty 50 trading session closes higher than the latest verified close. It is deliberately conservative: the bootstrap fetches data first, validates freshness, trains or refreshes the deployed model when needed, and only then opens the dashboard.</p>
      <div className="method-flow">
        <span>Fetch verified data</span><ChevronRight/><span>Build leakage-safe features</span><ChevronRight/><span>Walk-forward train/test</span><ChevronRight/><span>Calibrate probability</span><ChevronRight/><span>Deploy eligible model</span><ChevronRight/><span>Generate next-session view</span>
      </div>
    </section>

    <section className="method-grid">
      <DocCard title="1. Data fetching and freshness" help="What is downloaded and why official NSE data is overlaid on top of historical sources.">
        <p>The historical baseline comes from Yahoo chart history because it provides long daily series needed for 12-year training. Fresh Indian market values are then overlaid from official NSE sources, so the latest Nifty close, India VIX, FII/DII flow, participant OI and options EOD chain line up to the same official trading date.</p>
        <Table columns={['dataset','source','use']} rows={sourceRows}/>
        <ul>
          <li>Official NSE index snapshots are accepted only after 15:30 IST, so an intraday quote is not mistaken for an EOD close.</li>
          <li>FII/DII data must report the same date as the official index snapshot.</li>
          <li>Participant OI and options bhavcopy are fetched from official end-of-day archives.</li>
          <li>If a critical source is unavailable, the pipeline marks the dashboard partial/degraded instead of silently fabricating data.</li>
        </ul>
      </DocCard>

      <DocCard title="2. Target definition" help="The exact label the classifier learns.">
        <p>The classifier does not predict an intraday move. It predicts whether the next completed Nifty session closes above the latest verified close.</p>
        <Formula label="Next-day return" value="r[t+1] = close[t+1] / close[t] - 1"/>
        <Formula label="Classification target" value="target_up[t] = 1 if r[t+1] > 0 else 0"/>
        <Formula label="Regression target" value="target_return[t] = r[t+1]"/>
        <p>The final row has no future close yet, so it is used for live prediction but excluded from supervised training labels.</p>
      </DocCard>

      <DocCard title="3. Feature engineering" help="Signals created from price, volatility, flows, derivatives, options, global context and calendar effects.">
        <Table columns={['group','examples']} rows={featureRows}/>
        <p>Feature columns are numeric only. A feature also needs enough historical observations before it can enter model training, so a newly available one-day official feed can appear in the dashboard without pretending it existed throughout the full backtest.</p>
      </DocCard>

      <DocCard title="4. Leakage controls" help="How the app avoids using future or same-session data.">
        <ul>
          <li>Every stored market row carries an availability timestamp.</li>
          <li>Official Indian cash, OI and options data are treated as after-close data for the next session.</li>
          <li>Walk-forward validation trains only on dates strictly before each test block.</li>
          <li>Targets are shifted forward one day, while predictors come from information known at or after the latest close.</li>
          <li>Manual uploads are stored with provenance and still follow the same date alignment.</li>
        </ul>
      </DocCard>

      <DocCard title="5. Algorithms" help="The exact model family and preprocessing stack.">
        <p>The probability model is intentionally interpretable and stable rather than a black-box deep model.</p>
        <ul>
          <li><b>Classifier:</b> median imputation + missing indicators → robust scaling → class-balanced logistic regression → Platt sigmoid calibration.</li>
          <li><b>Regressor:</b> median imputation + missing indicators → robust scaling → Ridge regression for expected next-day return.</li>
          <li><b>Hyperparameters:</b> logistic C = 0.25, liblinear solver, max_iter = 2000; Ridge alpha = 8.0.</li>
          <li><b>Calibration:</b> sigmoid / Platt calibration using time-series folds inside the classifier wrapper.</li>
        </ul>
      </DocCard>

      <DocCard title="6. Walk-forward validation" help="How the backtest is produced.">
        <p>The backtest uses expanding-window walk-forward validation. It starts with about three years of training data, tests the next quarter, then expands the training window and repeats.</p>
        <Formula label="Minimum training window" value="756 trading rows"/>
        <Formula label="Test block" value="63 trading rows"/>
        <Formula label="Signal cost assumption" value="3 basis points per active trade"/>
        <p>The displayed accuracy, balanced accuracy, ROC-AUC, Brier score, log loss and equity curve all come from these out-of-sample predictions.</p>
      </DocCard>

      <DocCard title="7. Deployment gates" help="A model is not promoted just because it trained successfully.">
        <ul>
          <li>Accuracy must beat the majority-class baseline.</li>
          <li>Brier score must be below 0.25, so probability quality matters.</li>
          <li>At least 252 out-of-sample observations are required.</li>
          <li>Only an eligible candidate is promoted to deployed status unless a force override is deliberately used.</li>
        </ul>
      </DocCard>

      <DocCard title="8. Prediction and signal logic" help="How the final dashboard probability, range and labels are calculated.">
        <Formula label="Probability up" value="P(up) = calibrated logistic model predict_proba(latest_features)"/>
        <Formula label="Expected return" value="E[r] = Ridge model predict(latest_features)"/>
        <Formula label="Historical one-day move" value="hist_move = realized_vol_20d / sqrt(252)"/>
        <Formula label="VIX one-day move" value="vix_move = IndiaVIX / 100 / sqrt(365)"/>
        <Formula label="Model range move" value="implied_move = max(|E[r]| + return_MAE, average(hist_move, vix_move))"/>
        <Formula label="Expected range" value="lower = close x (1 - implied_move), upper = close x (1 + implied_move)"/>
        <p>Signal labels use probability thresholds: below 40% is strongly bearish, 40-47.5% mildly bearish, 47.5-52.5% neutral, 52.5-60% mildly bullish, and above 60% strongly bullish. If expected return does not clear the cost assumption and probability is near 50%, the signal stays neutral.</p>
      </DocCard>

      <DocCard title="9. Confidence and data quality" help="How the status badges are decided.">
        <Formula label="Completeness" value="non-missing required model features / total required model features"/>
        <p>Data quality is Complete at 90%+ completeness, Partial at 75%+, Degraded at 55%+, and Unsafe below that. Confidence also depends on how far the probability is from 50%; a clean 51% is still low confidence because the edge is tiny.</p>
      </DocCard>

      <DocCard title="10. Assumptions and limitations" help="Important boundaries so the numbers are not over-interpreted.">
        <ul>
          <li>This is a research tool, not financial advice or an execution system.</li>
          <li>Probabilities are conditional on the available data and can change when official data is revised.</li>
          <li>Holiday shifts, exchange publication delays and source blocking can affect freshness.</li>
          <li>Options bhavcopy is official EOD data but does not always include implied volatility fields.</li>
          <li>Backtest performance is useful for discipline, not a promise of future results.</li>
        </ul>
      </DocCard>
    </section>
    <Disclaimer/>
  </>
}

function DocCard({title,help,children}:{title:string;help:string;children:ReactNode}) {
  return <section className="panel doc-card"><PanelTitle label={title} note="Methodology detail" help={help}/>{children}</section>
}

function Formula({label,value}:{label:string;value:string}) {
  return <div className="formula"><span>{label}</span><code>{value}</code></div>
}

function ProbabilityGauge({value}:{value:number}) { const v=Math.max(0,Math.min(1,value)); const angle=-90+180*v; return <div className="gauge"><svg viewBox="0 0 220 130"><path d="M30 110 A80 80 0 0 1 190 110" pathLength="100" className="gauge-track"/><path d="M30 110 A80 80 0 0 1 190 110" pathLength="100" className="gauge-fill" strokeDasharray={`${v*100} 100`}/><g transform={`rotate(${angle} 110 110)`}><line x1="110" y1="110" x2="110" y2="42" className="needle"/><circle cx="110" cy="110" r="7"/></g></svg><div><b>{pct(v)}</b><span>PROBABILITY UP</span></div></div> }
function RangeBar({low,close,high}:{low:number;close:number;high:number}) { return <div className="rangebar"><div className="range-line"><i style={{left:'50%'}}/></div><div><span>{num(low)}</span><span>MODEL RANGE</span><span>{num(high)}</span></div></div> }
function PanelTitle({label,note,help}:{label:string;note:string;help?:string}) {return <div className="panel-title"><div><span>{label}</span><small>{note}</small></div><InfoTip text={help || note}/></div>}
function Kpi({label,value,sub,help}:{label:string;value:string;sub:string;help?:string}){return <div className="kpi"><div className="kpi-head"><span>{label}</span><InfoTip text={help || sub} compact/></div><b>{value}</b><small>{sub}</small></div>}
function FactorList({title,factors,kind}:{title:string;factors:Factor[];kind:'up'|'down'}) {return <div className="factors"><h4 className={kind==='up'?'green':'red'}>{title}</h4>{factors.length?factors.map((f,i)=><div className="factor" key={f.feature}><i>{i+1}</i><div><b>{f.interpretation}</b><small>{f.feature} · {f.value==null?'missing':Number(f.value).toFixed(3)}</small></div><em>{f.impact==null?'':signedPct(f.impact)}</em></div>):<p className="muted">Awaiting model attribution.</p>}</div>}
function DataBadge({status}:{status:string}){return <div className={`data-badge ${status.toLowerCase()}`}><i/>{status} data<InfoTip text="Data quality is based on the latest row's completeness versus the deployed model's required features. Complete means at least 90% of required model inputs are present; Partial, Degraded and Unsafe indicate progressively more missing inputs." compact/></div>}
function Empty({text}:{text:string}){return <div className="empty"><Database/><b>Waiting for verified data</b><p>{text}</p></div>}
function Table({columns,rows}:{columns:string[];rows:any[]}) {return <div className="table-scroll"><table><thead><tr>{columns.map(c=><th key={c}>{c.replaceAll('_',' ')}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{columns.map(c=><td key={c}>{formatCell(c,r[c])}</td>)}</tr>)}</tbody></table></div>}
function formatCell(c:string,v:any){if(typeof v==='number'){if(c==='rr')return v?`${v.toFixed(2)}x`:'—';if(c.includes('pl')||c.includes('profit')||c.includes('loss'))return money(v);if(c.includes('pop')||c.includes('prob')||c.includes('rate')||c.includes('return'))return pct(v);return num(v)}return String(v??'—')}
function Action({icon:Icon,title,desc,button,busy,onClick}:{icon:any;title:string;desc:string;button:string;busy:boolean;onClick:()=>void}){return <div className="panel action"><div className="action-top"><div className="action-icon"><Icon/></div><InfoTip text={desc}/></div><h3>{title}</h3><p>{desc}</p><button onClick={onClick} disabled={busy}>{busy?'Working…':button}</button></div>}
function Gate({text,help}:{text:string;help?:string}){return <div className="gate"><CheckCircle2/>{text}<InfoTip text={help || text} compact/></div>}
function InfoTip({text,compact=false}:{text:string;compact?:boolean}){return <span className={compact?'info-tip compact':'info-tip'} tabIndex={0} aria-label={text}><Info size={compact?12:14}/><span className="info-bubble">{text}</span></span>}
function Disclaimer(){return <div className="disclaimer"><AlertTriangle/><p><b>Research tool—not financial advice.</b> This is a calibrated probability estimate, not a guarantee. Past performance does not ensure future results. Data can be delayed or revised; expected value after costs matters more than raw hit rate. Make independent trading decisions.</p></div>}
function tone(s:string){return s.toLowerCase().includes('bull')?'bull':s.toLowerCase().includes('bear')?'bear':'neutral'}
function pct(v:number){return Number.isFinite(v)?`${(v*100).toFixed(1)}%`:'—'}
function signedPct(v:number){return Number.isFinite(v)?`${v>=0?'+':''}${(v*100).toFixed(2)}%`:'—'}
function num(v:number){return v?new Intl.NumberFormat('en-IN',{maximumFractionDigits:2}).format(v):'—'}
function money(v:number){return Number.isFinite(v)?`${v>=0?'+':'-'}₹${new Intl.NumberFormat('en-IN',{maximumFractionDigits:0}).format(Math.abs(v))}`:'—'}
function moneyShort(v:number){if(!Number.isFinite(v))return '—';const a=Math.abs(v),s=v<0?'-':'';return a>=100000?`${s}₹${(a/100000).toFixed(1)}L`:a>=1000?`${s}₹${(a/1000).toFixed(0)}k`:`${s}₹${a.toFixed(0)}`}
function metric(b:Backtest|null,k:string,d=1){return b&&typeof b.metrics[k]==='number'?(k.includes('accuracy')?pct(Number(b.metrics[k])):Number(b.metrics[k]).toFixed(d)):'—'}
const tip={background:'#0c1715',border:'1px solid #263d38',borderRadius:8,color:'#dce9e5'}

export default App
