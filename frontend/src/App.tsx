import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, AreaChart, ArrowDownRight, ArrowUpRight, BarChart3, BrainCircuit,
  CalendarClock, CheckCircle2, ChevronRight, Database, Gauge, Layers3, Menu, RefreshCw,
  Settings, ShieldCheck, SlidersHorizontal, Upload, X } from 'lucide-react'
import { Area, AreaChart as ReArea, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, Backtest, Factor, Prediction } from './api'

type Page = 'overview' | 'flows' | 'derivatives' | 'options' | 'backtest' | 'calibration' | 'models' | 'admin'

const nav: { id: Page; label: string; icon: typeof Gauge }[] = [
  { id: 'overview', label: 'Market Overview', icon: Gauge },
  { id: 'flows', label: 'FII / DII Flows', icon: ArrowUpRight },
  { id: 'derivatives', label: 'F&O Positioning', icon: Layers3 },
  { id: 'options', label: 'Options Analytics', icon: SlidersHorizontal },
  { id: 'backtest', label: 'Backtest', icon: AreaChart },
  { id: 'calibration', label: 'Calibration', icon: BarChart3 },
  { id: 'models', label: 'Model Lab', icon: BrainCircuit },
  { id: 'admin', label: 'Admin', icon: Settings },
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

  return <div className="shell">
    <aside className={mobile ? 'sidebar open' : 'sidebar'}>
      <button className="close-mobile" onClick={() => setMobile(false)} aria-label="Close menu"><X /></button>
      <div className="brand"><div className="mark"><Activity size={19}/></div><div><b>NIFTY<span>PROB</span></b><small>RESEARCH TERMINAL</small></div></div>
      <nav>{nav.map(item => <button className={page === item.id ? 'active' : ''} key={item.id} onClick={() => { setPage(item.id); setMobile(false) }}>
        <item.icon size={17}/><span>{item.label}</span>{page === item.id && <ChevronRight className="chev" size={15}/>}</button>)}</nav>
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
        <h1>{nav.find(n => n.id === page)?.label}</h1>
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
        {page === 'admin' && <Admin onDone={refresh} models={models}/>} 
      </div>
    </main>
  </div>
}

function Overview({prediction:p, backtest}:{prediction:Prediction; backtest:Backtest|null}) {
  return <>
    <section className="hero-grid">
      <div className="panel probability-panel">
        <PanelTitle label="Tomorrow's probability" note={`For ${p.next_trading_day}`}/>
        <ProbabilityGauge value={p.probability_up}/>
        <div className={`signal ${tone(p.signal)}`}>{p.signal}</div>
        <div className="prob-row"><div><span>UP</span><b>{pct(p.probability_up)}</b></div><div><span>DOWN</span><b>{pct(p.probability_down)}</b></div></div>
      </div>
      <div className="panel range-panel">
        <PanelTitle label="Expected next-day range" note="Blended VIX + realized vol + model error"/>
        <div className="spot"><span>NIFTY CLOSE</span><b>{num(p.nifty_close)}</b><small>{p.date}</small></div>
        <RangeBar low={p.expected_lower_range} close={p.nifty_close} high={p.expected_upper_range}/>
        <div className="range-stats"><div><ArrowDownRight/><span>Lower bound</span><b>{num(p.expected_lower_range)}</b></div><div><ArrowUpRight/><span>Upper bound</span><b>{num(p.expected_upper_range)}</b></div></div>
      </div>
      <div className="panel regime-panel"><PanelTitle label="Market regime" note="Rules-based state classification"/>
        <div className="regime-icon"><Activity/></div><h2>{p.regime}</h2><p>Current trend, realized volatility and expiry context.</p>
        <div className="mini-grid"><div><span>EXPECTED RETURN</span><b className={p.expected_return >= 0 ? 'green' : 'red'}>{signedPct(p.expected_return)}</b></div><div><span>CONFIDENCE</span><b>{p.confidence}</b></div><div><span>INDIA VIX</span><b>{p.india_vix?.toFixed(2) ?? '—'}</b></div><div><span>COMPLETENESS</span><b>{pct(p.data_completeness)}</b></div></div>
      </div>
    </section>
    <section className="kpi-row">
      <Kpi label="Walk-forward accuracy" value={metric(backtest, 'accuracy')} sub="Strict out-of-sample"/>
      <Kpi label="Brier score" value={metric(backtest, 'brier_score', 3)} sub="Lower is better"/>
      <Kpi label="ROC-AUC" value={metric(backtest, 'roc_auc', 3)} sub="Discrimination"/>
      <Kpi label="Backtest samples" value={backtest ? String(backtest.metrics.samples ?? '—') : '—'} sub="Out-of-sample days"/>
    </section>
    <section className="two-col">
      <div className="panel"><PanelTitle label="Signal drivers" note="One-feature perturbation attribution"/><div className="factor-columns">
        <FactorList title="BULLISH" factors={p.top_bullish_factors} kind="up"/><FactorList title="BEARISH" factors={p.top_bearish_factors} kind="down"/>
      </div></div>
      <div className="panel"><PanelTitle label="Calibration snapshot" note="Predicted probability vs observed hit rate"/>
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
  return <><section className="two-col"><div className="panel wide"><PanelTitle label="Institutional cash flow" note="₹ crore · FII vs DII net activity"/>
    {chart.length ? <ResponsiveContainer width="100%" height={340}><BarChart data={chart}><CartesianGrid stroke="#1b302c" vertical={false}/><XAxis dataKey="date" hide/><YAxis stroke="#66807a"/><Tooltip contentStyle={tip}/><Bar dataKey="fii_net" fill="#f06a69" radius={[2,2,0,0]}/><Bar dataKey="dii_net" fill="#51e6a6" radius={[2,2,0,0]}/></BarChart></ResponsiveContainer> : <Empty text="Upload FII/DII CSV from Admin to activate flow analytics."/>}
  </div><div className="panel"><PanelTitle label="Availability discipline" note="Close-to-next-session alignment"/><div className="explain-block"><ShieldCheck/><h3>No same-session leakage</h3><p>Cash activity stamped after the Indian close is used only to predict the next trading session.</p></div></div></section>
  <div className="panel table-panel"><PanelTitle label="Recent observations" note={`${rows.length} rows loaded`}/><Table columns={['date','fii_net','dii_net','fii_buy','fii_sell','source']} rows={rows.slice(0,20)}/></div></>
}

function Derivatives() {
  const [rows,setRows]=useState<any[]>([])
  useEffect(()=>{api<any[]>('/api/fno/latest').then(setRows).catch(()=>{})},[])
  return <section className="panel"><PanelTitle label="Participant positioning" note="Index futures net long / short"/>
    {rows.length ? <div className="position-grid">{rows.map(r=><div className="position" key={r.participant}><span>{r.participant}</span><b className={r.index_futures_net>=0?'green':'red'}>{num(r.index_futures_net)}</b><small>NET INDEX FUTURES</small><div className="split"><i style={{width:`${Math.max(8,Math.min(92,100*(r.index_futures_long/(r.index_futures_long+r.index_futures_short))))}%`}}/></div></div>)}</div> : <Empty text="Participant OI is unavailable. Import official NSE EOD participant data to populate this module."/>}
  </section>
}

function Options({prediction:p}:{prediction:Prediction}) {
  const [spot,setSpot]=useState(p.nifty_close||25000); const [vix,setVix]=useState(p.india_vix||14); const [days,setDays]=useState(1)
  const d365=vix/100/Math.sqrt(365)*Math.sqrt(days), d252=vix/100/Math.sqrt(252)*Math.sqrt(days)
  return <section className="two-col"><div className="panel"><PanelTitle label="Expected range calculator" note="VIX annualized conventions"/>
    <div className="form-grid"><label>Nifty CMP<input type="number" value={spot} onChange={e=>setSpot(+e.target.value)}/></label><label>India VIX<input type="number" value={vix} onChange={e=>setVix(+e.target.value)}/></label><label>Days to expiry<input type="number" min="1" max="60" value={days} onChange={e=>setDays(+e.target.value)}/></label></div>
    <div className="calc-results"><div><span>365-DAY LOWER</span><b>{num(spot*(1-d365))}</b></div><div><span>365-DAY UPPER</span><b>{num(spot*(1+d365))}</b></div><div><span>252-DAY LOWER</span><b>{num(spot*(1-d252))}</b></div><div><span>252-DAY UPPER</span><b>{num(spot*(1+d252))}</b></div></div>
  </div><div className="panel"><PanelTitle label="Options-chain analytics" note="EOD, nearest valid expiry"/><Empty text="PCR, walls, max pain and IV skew appear when options EOD data is loaded. Live NSE scraping is not silently substituted for auditable EOD data."/></div></section>
}

function BacktestPage({data}:{data:Backtest|null}) {
  return <>{!data ? <div className="panel"><Empty text="Run model training to generate a walk-forward backtest."/></div> : <>
    <section className="kpi-row"><Kpi label="Accuracy" value={pct(Number(data.metrics.accuracy))} sub="Out of sample"/><Kpi label="Balanced accuracy" value={pct(Number(data.metrics.balanced_accuracy))} sub="Class adjusted"/><Kpi label="Return MAE" value={pct(Number(data.metrics.mae_return))} sub="Regression error"/><Kpi label="Log loss" value={Number(data.metrics.log_loss).toFixed(3)} sub="Probability penalty"/></section>
    <section className="panel"><PanelTitle label="Signal equity curve" note="55/45 thresholds · 3 bps costs"/><ResponsiveContainer width="100%" height={360}><ReArea data={data.equity_curve}><defs><linearGradient id="eq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#51e6a6" stopOpacity={.4}/><stop offset="1" stopColor="#51e6a6" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#1b302c" vertical={false}/><XAxis dataKey="date" hide/><YAxis stroke="#66807a" domain={['auto','auto']}/><Tooltip contentStyle={tip}/><Area dataKey="equity" stroke="#51e6a6" fill="url(#eq)" strokeWidth={2}/></ReArea></ResponsiveContainer></section>
    <section className="panel table-panel"><PanelTitle label="Threshold analysis" note="Expected value after transaction costs"/><Table columns={['threshold','trades','hit_rate','total_return']} rows={data.threshold_analysis}/></section>
  </>}</>
}

function Calibration({data}:{data:Backtest|null}) {
  const bars=data?.calibration||[]
  return <><section className="kpi-row"><Kpi label="Brier score" value={data?Number(data.metrics.brier_score).toFixed(3):'—'} sub="Ideal approaches 0"/><Kpi label="Log loss" value={data?Number(data.metrics.log_loss).toFixed(3):'—'} sub="Confidence penalty"/><Kpi label="Calibration method" value="Platt" sub="Time-series folds"/><Kpi label="Buckets" value={String(bars.length||'—')} sub="Reliability bins"/></section>
  <section className="panel"><PanelTitle label="Reliability by probability bucket" note="Observed frequency should track predicted probability"/>{bars.length?<ResponsiveContainer width="100%" height={360}><BarChart data={bars}><CartesianGrid stroke="#1b302c" vertical={false}/><XAxis dataKey="bucket" stroke="#66807a"/><YAxis domain={[0,1]} tickFormatter={pct} stroke="#66807a"/><Tooltip contentStyle={tip}/><Bar dataKey="predicted" fill="#304842"/><Bar dataKey="actual" fill="#51e6a6"/></BarChart></ResponsiveContainer>:<Empty text="Calibration buckets appear after training."/>}</section></>
}

function Models({rows}:{rows:any[]}) {
  return <><section className="panel"><PanelTitle label="Model registry" note="Candidates, deployment gates and rollback history"/>{rows.length?<div className="model-list">{rows.map(r=><div className="model-row" key={r.version}><div className="model-icon"><BrainCircuit/></div><div><b>{r.version}</b><small>{r.algorithm} · {r.calibration_method}</small></div><div><span>ACCURACY</span><b>{pct(r.metrics.accuracy)}</b></div><div><span>BRIER</span><b>{Number(r.metrics.brier_score).toFixed(3)}</b></div><em className={`status ${r.status}`}>{r.status}</em></div>)}</div>:<Empty text="No model versions yet. Train the first candidate from Admin."/>}</section>
  <section className="panel"><PanelTitle label="Deployment policy" note="A model must earn promotion"/><div className="gate-grid"><Gate text="Beats majority-class baseline"/><Gate text="Brier score below 0.25"/><Gate text="At least 252 out-of-sample observations"/><Gate text="Explicit force override is audited"/></div></section></>
}

function Admin({onDone,models}:{onDone:()=>void;models:any[]}) {
  const [key,setKey]=useState(''); const [busy,setBusy]=useState(''); const [message,setMessage]=useState(''); const [dataset,setDataset]=useState('nifty')
  const action=async(name:string,path:string,body?:unknown)=>{setBusy(name);setMessage('');try{const result=await api<any>(path,{method:'POST',headers:{'X-Admin-Key':key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});setMessage(`${name} completed: ${result.model_version||result.rows_processed||result.status||'OK'}`);onDone()}catch(e){setMessage((e as Error).message)}finally{setBusy('')}}
  const upload=async(file:File)=>{setBusy('Upload');const form=new FormData();form.append('file',file);try{const result=await api<any>(`/api/admin/upload-csv?dataset=${dataset}`,{method:'POST',headers:{'X-Admin-Key':key},body:form});setMessage(`Imported ${result.rows} ${dataset} rows`);onDone()}catch(e){setMessage((e as Error).message)}finally{setBusy('')}}
  return <><section className="panel admin-head"><div><PanelTitle label="Pipeline control" note="Privileged actions require the server-side API key"/></div><label>ADMIN API KEY<input type="password" value={key} onChange={e=>setKey(e.target.value)} placeholder="Enter key"/></label></section>
  {message&&<div className="notice"><CheckCircle2 size={16}/>{message}</div>}
  <section className="action-grid"><Action icon={Database} title="Fetch market data" desc="Refresh Nifty, VIX, global and macro series with retry + cache." button="Fetch now" busy={busy==='Fetch'} onClick={()=>action('Fetch','/api/admin/fetch-data')}/><Action icon={BrainCircuit} title="Train candidate" desc="Leakage-safe walk-forward validation, calibration and registry entry." button="Retrain" busy={busy==='Retrain'} onClick={()=>action('Retrain','/api/admin/retrain-model')}/><Action icon={ShieldCheck} title="Deploy eligible model" desc="Promote only after baseline, calibration and sample gates pass." button="Deploy latest eligible" busy={busy==='Deploy'} onClick={()=>{const row=models.find(m=>m.status==='eligible');if(row)action('Deploy','/api/admin/deploy-model',{model_version:row.version});else setMessage('No eligible candidate is available.')}}/></section>
  <section className="panel upload-panel"><PanelTitle label="Manual CSV fallback" note="Validated, previewed and stored with manual_upload provenance"/><div className="upload-controls"><select value={dataset} onChange={e=>setDataset(e.target.value)}><option value="nifty">Nifty OHLC</option><option value="india_vix">India VIX</option><option value="fii_dii">FII / DII cash</option><option value="participant_oi">Participant OI</option><option value="options">Options chain EOD</option><option value="breadth">Market breadth</option><option value="global">Global market</option><option value="macro">Macro series</option></select><label className="upload-button"><Upload size={17}/>{busy==='Upload'?'Uploading…':'Choose CSV'}<input type="file" accept=".csv" onChange={e=>e.target.files?.[0]&&upload(e.target.files[0])}/></label></div></section></>
}

function ProbabilityGauge({value}:{value:number}) { const v=Math.max(0,Math.min(1,value)); const angle=-90+180*v; return <div className="gauge"><svg viewBox="0 0 220 130"><path d="M30 110 A80 80 0 0 1 190 110" pathLength="100" className="gauge-track"/><path d="M30 110 A80 80 0 0 1 190 110" pathLength="100" className="gauge-fill" strokeDasharray={`${v*100} 100`}/><g transform={`rotate(${angle} 110 110)`}><line x1="110" y1="110" x2="110" y2="42" className="needle"/><circle cx="110" cy="110" r="7"/></g></svg><div><b>{pct(v)}</b><span>PROBABILITY UP</span></div></div> }
function RangeBar({low,close,high}:{low:number;close:number;high:number}) { return <div className="rangebar"><div className="range-line"><i style={{left:'50%'}}/></div><div><span>{num(low)}</span><span>MODEL RANGE</span><span>{num(high)}</span></div></div> }
function PanelTitle({label,note}:{label:string;note:string}) {return <div className="panel-title"><div><span>{label}</span><small>{note}</small></div><i/></div>}
function Kpi({label,value,sub}:{label:string;value:string;sub:string}){return <div className="kpi"><span>{label}</span><b>{value}</b><small>{sub}</small></div>}
function FactorList({title,factors,kind}:{title:string;factors:Factor[];kind:'up'|'down'}) {return <div className="factors"><h4 className={kind==='up'?'green':'red'}>{title}</h4>{factors.length?factors.map((f,i)=><div className="factor" key={f.feature}><i>{i+1}</i><div><b>{f.interpretation}</b><small>{f.feature} · {f.value==null?'missing':Number(f.value).toFixed(3)}</small></div><em>{f.impact==null?'':signedPct(f.impact)}</em></div>):<p className="muted">Awaiting model attribution.</p>}</div>}
function DataBadge({status}:{status:string}){return <div className={`data-badge ${status.toLowerCase()}`}><i/>{status} data</div>}
function Empty({text}:{text:string}){return <div className="empty"><Database/><b>Waiting for verified data</b><p>{text}</p></div>}
function Table({columns,rows}:{columns:string[];rows:any[]}) {return <div className="table-scroll"><table><thead><tr>{columns.map(c=><th key={c}>{c.replaceAll('_',' ')}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{columns.map(c=><td key={c}>{typeof r[c]==='number'?(c.includes('rate')||c.includes('return')?pct(r[c]):num(r[c])):String(r[c]??'—')}</td>)}</tr>)}</tbody></table></div>}
function Action({icon:Icon,title,desc,button,busy,onClick}:{icon:any;title:string;desc:string;button:string;busy:boolean;onClick:()=>void}){return <div className="panel action"><div className="action-icon"><Icon/></div><h3>{title}</h3><p>{desc}</p><button onClick={onClick} disabled={busy}>{busy?'Working…':button}</button></div>}
function Gate({text}:{text:string}){return <div className="gate"><CheckCircle2/>{text}</div>}
function Disclaimer(){return <div className="disclaimer"><AlertTriangle/><p><b>Research tool—not financial advice.</b> This is a calibrated probability estimate, not a guarantee. Past performance does not ensure future results. Data can be delayed or revised; expected value after costs matters more than raw hit rate. Make independent trading decisions.</p></div>}
function tone(s:string){return s.toLowerCase().includes('bull')?'bull':s.toLowerCase().includes('bear')?'bear':'neutral'}
function pct(v:number){return Number.isFinite(v)?`${(v*100).toFixed(1)}%`:'—'}
function signedPct(v:number){return Number.isFinite(v)?`${v>=0?'+':''}${(v*100).toFixed(2)}%`:'—'}
function num(v:number){return v?new Intl.NumberFormat('en-IN',{maximumFractionDigits:2}).format(v):'—'}
function metric(b:Backtest|null,k:string,d=1){return b&&typeof b.metrics[k]==='number'?(k.includes('accuracy')?pct(Number(b.metrics[k])):Number(b.metrics[k]).toFixed(d)):'—'}
const tip={background:'#0c1715',border:'1px solid #263d38',borderRadius:8,color:'#dce9e5'}

export default App
