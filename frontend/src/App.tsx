import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Activity, AlertTriangle, AreaChart, ArrowDownRight, ArrowUpRight, BarChart3, BookOpen, BrainCircuit,
  CalendarClock, CheckCircle2, ChevronRight, Database, Gauge, Info, Layers3, Menu, RefreshCw,
  Settings, ShieldCheck, SlidersHorizontal, Upload, X } from 'lucide-react'
import { Area, AreaChart as ReArea, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, Backtest, Factor, Prediction } from './api'

type Page = 'overview' | 'flows' | 'derivatives' | 'options' | 'backtest' | 'calibration' | 'models' | 'methodology' | 'admin'

const nav: { id: Page; label: string; icon: typeof Gauge; help: string }[] = [
  { id: 'overview', label: 'Market Overview', icon: Gauge, help: 'Executive dashboard for the next Nifty session. Read this first: it combines the calibrated up-probability, expected return, model range, market regime, data quality, and the strongest feature-level drivers behind the current call.' },
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
      </div><div className="header-actions"><DataBadge status={prediction.data_quality}/><button className="icon-btn" onClick={refresh} title="Refresh"><RefreshCw className={loading ? 'spin' : ''} size={17}/></button></div></header>
      {notice && <div className="notice"><AlertTriangle size={16}/><span>{notice}</span><button onClick={() => setNotice('')}><X size={15}/></button></div>}
      <div className="content">
        {page === 'overview' && <Overview prediction={prediction} backtest={backtest}/>} 
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

function BacktestPage({data}:{data:Backtest|null}) {
  return <>{!data ? <div className="panel"><Empty text="Run model training to generate a walk-forward backtest."/></div> : <>
    <section className="kpi-row"><Kpi label="Accuracy" value={pct(Number(data.metrics.accuracy))} sub="Out of sample" help="Share of walk-forward days where the model's probability crossed 50% in the correct direction. Useful but incomplete because it ignores confidence and probability calibration."/><Kpi label="Balanced accuracy" value={pct(Number(data.metrics.balanced_accuracy))} sub="Class adjusted" help="Average of up-day accuracy and down-day accuracy. This prevents the score from looking good merely because one class, such as up days, occurs more often."/><Kpi label="Return MAE" value={pct(Number(data.metrics.mae_return))} sub="Regression error" help="Mean absolute error of the expected-return model. This is used in the expected-range calculation as a cushion for typical forecast error."/><Kpi label="Log loss" value={Number(data.metrics.log_loss).toFixed(3)} sub="Probability penalty" help="Probability scoring metric that heavily penalizes confident wrong forecasts. Lower log loss means the model is less reckless with high-conviction predictions."/></section>
    <section className="panel"><PanelTitle label="Signal equity curve" note="55/45 thresholds · 3 bps costs" help="Hypothetical out-of-sample equity curve from a simple signal rule: long when P(up) ≥ 55%, short when P(up) ≤ 45%, otherwise flat, with 3 bps transaction cost per active trade. It is a stress-test of signal usefulness, not an executable trading system."/><ResponsiveContainer width="100%" height={360}><ReArea data={data.equity_curve}><defs><linearGradient id="eq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#51e6a6" stopOpacity={.4}/><stop offset="1" stopColor="#51e6a6" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#1b302c" vertical={false}/><XAxis dataKey="date" hide/><YAxis stroke="#66807a" domain={['auto','auto']}/><Tooltip contentStyle={tip}/><Area dataKey="equity" stroke="#51e6a6" fill="url(#eq)" strokeWidth={2}/></ReArea></ResponsiveContainer></section>
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
function Table({columns,rows}:{columns:string[];rows:any[]}) {return <div className="table-scroll"><table><thead><tr>{columns.map(c=><th key={c}>{c.replaceAll('_',' ')}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{columns.map(c=><td key={c}>{typeof r[c]==='number'?(c.includes('rate')||c.includes('return')?pct(r[c]):num(r[c])):String(r[c]??'—')}</td>)}</tr>)}</tbody></table></div>}
function Action({icon:Icon,title,desc,button,busy,onClick}:{icon:any;title:string;desc:string;button:string;busy:boolean;onClick:()=>void}){return <div className="panel action"><div className="action-top"><div className="action-icon"><Icon/></div><InfoTip text={desc}/></div><h3>{title}</h3><p>{desc}</p><button onClick={onClick} disabled={busy}>{busy?'Working…':button}</button></div>}
function Gate({text,help}:{text:string;help?:string}){return <div className="gate"><CheckCircle2/>{text}<InfoTip text={help || text} compact/></div>}
function InfoTip({text,compact=false}:{text:string;compact?:boolean}){return <span className={compact?'info-tip compact':'info-tip'} tabIndex={0} aria-label={text}><Info size={compact?12:14}/><span className="info-bubble">{text}</span></span>}
function Disclaimer(){return <div className="disclaimer"><AlertTriangle/><p><b>Research tool—not financial advice.</b> This is a calibrated probability estimate, not a guarantee. Past performance does not ensure future results. Data can be delayed or revised; expected value after costs matters more than raw hit rate. Make independent trading decisions.</p></div>}
function tone(s:string){return s.toLowerCase().includes('bull')?'bull':s.toLowerCase().includes('bear')?'bear':'neutral'}
function pct(v:number){return Number.isFinite(v)?`${(v*100).toFixed(1)}%`:'—'}
function signedPct(v:number){return Number.isFinite(v)?`${v>=0?'+':''}${(v*100).toFixed(2)}%`:'—'}
function num(v:number){return v?new Intl.NumberFormat('en-IN',{maximumFractionDigits:2}).format(v):'—'}
function metric(b:Backtest|null,k:string,d=1){return b&&typeof b.metrics[k]==='number'?(k.includes('accuracy')?pct(Number(b.metrics[k])):Number(b.metrics[k]).toFixed(d)):'—'}
const tip={background:'#0c1715',border:'1px solid #263d38',borderRadius:8,color:'#dce9e5'}

export default App
