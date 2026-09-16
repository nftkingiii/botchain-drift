import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowDown, ArrowDownToLine, ArrowUp, Check, ChevronDown, CircleHelp, Clock3, FilePlus2, Filter, GitCompareArrows, Layers3, LoaderCircle, LockKeyhole, Menu, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Wallet, X } from 'lucide-react'
import { buildArtifact, buildScenarios, validateScenario, type ScenarioInput } from '../domain/scenarios'
import { ABI, anchorArtifact, BOT, connectWallet, CONTRACT_ADDRESS, readChainStatus, type ChainStatus, type WalletContext } from '../providers/chain'

type Tab = 'rehearse' | 'compare' | 'library'
type Report = { id: string; title: string; symbol: string; savedAt: string; artifact: ReturnType<typeof buildArtifact>; artifactHash?: string; chainTx?: string; chainBlock?: number; chainAuthor?: string }
type Market = { symbol: string; price: number; observedAt: string; source: string }
const STORE_PREFIX = 'drift.v1'
const blankInput: ScenarioInput = { entry: 0, direction: 'up', endpointPct: 8, adversePct: 12, horizonHours: 72, feePct: 0.12 }
const fmt = (n: number, digits = 2) => n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
const short = (text: string, left = 7, right = 5) => text.length > left + right + 3 ? `${text.slice(0, left)}…${text.slice(-right)}` : text
const readEnv = import.meta.env as ImportMetaEnv & { VITE_DRIFT_CONTRACT_ADDRESS?: string }

export function App() {
  const [tab, setTab] = useState<Tab>(() => (location.hash.replace('#/', '') as Tab) || 'rehearse')
  const [wallet, setWallet] = useState<WalletContext | null>(null)
  const [walletError, setWalletError] = useState('')
  const [chainStatus, setChainStatus] = useState<ChainStatus | null>(null)
  const [chainError, setChainError] = useState('')
  const [chainLoading, setChainLoading] = useState(true)
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [market, setMarket] = useState<Market | null>(null)
  const [priceOverride, setPriceOverride] = useState(false)
  const [marketError, setMarketError] = useState('')
  const [marketLoading, setMarketLoading] = useState(false)
  const [input, setInput] = useState<ScenarioInput>(blankInput)
  const [thesis, setThesis] = useState('')
  const [title, setTitle] = useState('')
  const [reports, setReports] = useState<Report[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'anchored' | 'local'>('all')
  const [busy, setBusy] = useState<'save' | 'anchor' | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string; tx?: string } | null>(null)
  const [activeReport, setActiveReport] = useState<Report | null>(null)
  const [visibleLines, setVisibleLines] = useState<string[]>(['baseline', 'shock', 'delay'])
  const storeKey = `${STORE_PREFIX}:${BOT.chainId}:${CONTRACT_ADDRESS.toLowerCase() || 'unconfigured'}:${wallet?.account.toLowerCase() || 'anonymous'}`
  const scenarios = useMemo(() => input.entry > 0 ? buildScenarios(input) : [], [input])
  const errors = validateScenario(input)
  const dataAge = market ? Date.now() - new Date(market.observedAt).getTime() : Infinity
  const stale = dataAge > 90_000

  useEffect(() => { location.hash = `/${tab}` }, [tab])
  useEffect(() => {
    const onHash = () => { const value = location.hash.replace('#/', ''); if (['rehearse', 'compare', 'library'].includes(value)) setTab(value as Tab) }
    addEventListener('hashchange', onHash); return () => removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(storeKey) || '[]'); setReports(Array.isArray(saved) ? saved.filter((r) => typeof r.id === 'string' && r.artifact) : []) }
    catch { setReports([]) }
    setSelected([]); setActiveReport(null)
  }, [storeKey])
  useEffect(() => {
    let mounted = true
    readChainStatus().then((status) => { if (mounted) setChainStatus(status) }).catch((error: unknown) => { if (mounted) setChainError(error instanceof Error ? error.message : 'Chain read failed.') }).finally(() => { if (mounted) setChainLoading(false) })
    return () => { mounted = false }
  }, [])
  useEffect(() => {
    const provider = window.ethereum
    if (!provider?.on) return
    const accountsChanged = (value: string[] | string) => {
      const accounts = Array.isArray(value) ? value : []
      setWallet((current) => accounts[0] && current ? { ...current, account: accounts[0] } : null)
      setMessage(null)
    }
    const chainChanged = (value: string[] | string) => {
      const chainHex = Array.isArray(value) ? '' : value
      setWallet((current) => current ? { ...current, chainId: Number.parseInt(chainHex, 16) } : null)
      setMessage(null)
    }
    provider.on('accountsChanged', accountsChanged); provider.on('chainChanged', chainChanged)
    return () => { provider.removeListener?.('accountsChanged', accountsChanged); provider.removeListener?.('chainChanged', chainChanged) }
  }, [])

  async function refreshMarket(nextSymbol = symbol) {
    setMarketLoading(true); setMarketError('')
    try {
      const response = await fetch(`/api/market?symbol=${encodeURIComponent(nextSymbol.toUpperCase())}`, { cache: 'no-store' })
      const body = await response.json() as Market & { error?: string }
      if (!response.ok) throw new Error(body.error || 'Market source is unavailable.')
      setMarket(body); setPriceOverride(false); setSymbol(body.symbol); setInput((current) => ({ ...current, entry: body.price }))
    } catch (error) { setMarketError(error instanceof Error ? error.message : 'Market source is unavailable.') }
    finally { setMarketLoading(false) }
  }
  useEffect(() => { void refreshMarket('BTCUSDT') }, [])
  useEffect(() => { const timer = setInterval(() => { if (document.visibilityState === 'visible' && symbol) void refreshMarket(symbol) }, 45_000); return () => clearInterval(timer) }, [symbol])

  function update(patch: Partial<ScenarioInput>) { setInput((current) => ({ ...current, ...patch })); setMessage(null) }
  function persist(next: Report[]) { setReports(next); try { localStorage.setItem(storeKey, JSON.stringify(next)) } catch { setMessage({ type: 'error', text: 'Browser storage is full. Export a rehearsal before clearing old entries.' }) } }
  function newRehearsal() { setActiveReport(null); setTitle(''); setThesis(''); setPriceOverride(false); update({ ...blankInput, entry: market?.price ?? input.entry }); setTab('rehearse') }
  function selectTab(next: Tab) { setTab(next); setMessage(null) }

  async function saveReport() {
    if (errors.length || !thesis.trim()) { setMessage({ type: 'error', text: errors[0] || 'Add a thesis note before saving this rehearsal.' }); return }
    setBusy('save')
    const id = crypto.randomUUID()
    const artifact = buildArtifact(input, thesis, symbol, !priceOverride ? market?.observedAt ?? null : null, id)
    const report: Report = { id, title: title.trim() || `${symbol} · ${new Date().toLocaleDateString()}`, symbol, savedAt: new Date().toISOString(), artifact }
    persist([report, ...reports]); setActiveReport(report); setMessage({ type: 'success', text: 'Saved locally in this browser, scoped to this account and contract.' }); setBusy(null)
  }

  async function anchorReport(report: Report) {
    if (!wallet) { setMessage({ type: 'error', text: 'Connect a wallet on BOT Chain Testnet to continue.' }); return }
    if (wallet.chainId !== BOT.chainId) { setMessage({ type: 'error', text: 'Wallet is connected to another chain. Use the wallet button to switch to BOT Chain Testnet.' }); return }
    if (report.chainTx) { setMessage({ type: 'info', text: 'This saved report already has an anchor transaction.', tx: report.chainTx }); return }
    setBusy('anchor'); setMessage({ type: 'info', text: 'Simulating the contract call…' })
    try {
      const result = await anchorArtifact(wallet, report.id, report.artifact, (phase) => {
        const copy = { simulation: 'Simulating contract call…', wallet: 'Review and confirm the request in your wallet…', pending: 'Transaction submitted; waiting for one confirmation…', confirmation: 'Confirmed; checking the on-chain receipt…' }[phase]
        setMessage({ type: 'info', text: copy })
      })
      const updated = { ...report, artifactHash: result.artifactHash, chainTx: result.transactionHash, chainBlock: result.blockNumber, chainAuthor: result.author }
      persist(reports.map((entry) => entry.id === report.id ? updated : entry)); setActiveReport(updated)
      setMessage({ type: 'success', text: `Commitment anchored and read back at block ${result.blockNumber}. This proves only that this artifact hash was recorded.`, tx: result.transactionHash })
    } catch (error) {
      const code = (error as { code?: number }).code
      setMessage({ type: 'error', text: code === 4001 ? 'Wallet request was rejected.' : error instanceof Error ? error.message : 'Anchor failed.' })
    } finally { setBusy(null) }
  }

  async function onConnect() {
    setWalletError('')
    if (wallet) { setWallet(null); setWalletError('Wallet disconnected from Drift. The site cannot revoke the wallet’s site permission.'); return }
    try { setWallet(await connectWallet()) }
    catch (error) { setWalletError(error instanceof Error ? error.message : 'Wallet connection failed.') }
  }

  function exportReport(report: Report) {
    const blob = new Blob([JSON.stringify({ ...report.artifact, artifactHash: report.artifactHash ?? null, anchor: report.chainTx ? { transactionHash: report.chainTx, block: report.chainBlock, author: report.chainAuthor } : null }, null, 2)], { type: 'application/json' })
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `drift-${report.symbol}-${report.id.slice(0, 8)}.json`; link.click(); URL.revokeObjectURL(link.href)
  }

  const filtered = reports.filter((report) => report.title.toLowerCase().includes(query.toLowerCase()) || report.symbol.toLowerCase().includes(query.toLowerCase()) || report.artifact.thesis.toLowerCase().includes(query.toLowerCase())).filter((report) => filter === 'all' || (filter === 'anchored' ? Boolean(report.chainTx) : !report.chainTx))
  const compare = reports.filter((report) => selected.includes(report.id)).slice(0, 3)

  return <div className="shell">
    <aside className="rail" aria-label="Main navigation">
      <a className="wordmark" href="#/rehearse" onClick={() => selectTab('rehearse')}><img src="/drift-mark.svg" alt="" width="34" height="34"/><span>drift</span></a>
      <div className="rail-divider" />
      <nav className="nav-list">
        <button className={tab === 'rehearse' ? 'nav-item active' : 'nav-item'} onClick={() => selectTab('rehearse')}><Activity size={18}/><span>Rehearse</span><kbd>1</kbd></button>
        <button className={tab === 'compare' ? 'nav-item active' : 'nav-item'} onClick={() => selectTab('compare')}><GitCompareArrows size={18}/><span>Compare</span>{selected.length > 0 && <b className="nav-count">{selected.length}</b>}</button>
        <button className={tab === 'library' ? 'nav-item active' : 'nav-item'} onClick={() => selectTab('library')}><Layers3 size={18}/><span>Library</span><span className="nav-count">{reports.length}</span></button>
      </nav>
      <div className="rail-spacer" />
      <div className="chain-mini"><span className={chainError ? 'status-dot down' : 'status-dot'} /><div><strong>BOT Chain Testnet</strong><span>{chainLoading ? 'Reading network…' : chainError ? 'Read unavailable' : `Block ${chainStatus?.block.toLocaleString()}`}</span></div></div>
      <button className="rail-help" title="About Drift" onClick={() => setMessage({ type: 'info', text: 'Drift compares deterministic scenarios using an observed public market reference or a user-entered value. It does not forecast or place trades.' })}><CircleHelp size={17}/><span>About this workspace</span></button>
    </aside>

    <main className="main">
      <header className="topbar">
        <div className="crumb"><span>Workspace</span><span className="crumb-sep">/</span><strong>{tab === 'rehearse' ? 'Rehearse' : tab === 'compare' ? 'Compare' : 'Library'}</strong></div>
        <div className="top-actions">
          <span className={chainError ? 'chain-pill error' : 'chain-pill'} title={chainError || (chainStatus ? `${chainStatus.codeBytes} bytecode bytes · ${chainStatus.schema}` : 'Reading chain')}><span className="status-dot"/>{chainLoading ? 'Reading chain' : chainError ? 'Chain read issue' : `Testnet · ${chainStatus?.targetChain ?? '—'}`}</span>
          <button className={wallet ? 'wallet-button connected' : 'wallet-button'} onClick={() => void onConnect()} title={wallet ? 'Disconnect wallet from Drift' : 'Connect EVM wallet'}><Wallet size={16}/><span>{wallet ? `${short(wallet.account, 5, 4)}${wallet.chainId !== BOT.chainId ? ' · wrong network' : ''}` : 'Connect wallet'}</span></button>
        </div>
      </header>
      <section className="content">
        {tab === 'rehearse' && <>
          <div className="page-heading"><div><h1>Rehearse a decision.</h1><p>Write the thesis. Inspect the paths it depends on.</p></div><button className="quiet-button" onClick={newRehearsal}><FilePlus2 size={16}/> New rehearsal</button></div>
          <div className="ticker-row">
            <form className="market-pick" onSubmit={(event) => { event.preventDefault(); void refreshMarket(symbol) }}><label htmlFor="symbol">Reference market</label><input id="symbol" maxLength={16} value={symbol} onChange={(event) => { const next = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); setSymbol(next); setMarket(null); setPriceOverride(false); setInput((current) => ({ ...current, entry: 0 })) }}/><button type="submit" className="icon-control" title="Refresh public market reference" aria-label="Refresh market reference" disabled={marketLoading}>{marketLoading ? <LoaderCircle className="spin" size={17}/> : <RefreshCw size={16}/>}</button></form>
            <div className="ticker-price"><span>Observed reference</span><strong>{input.entry > 0 ? fmt(input.entry, input.entry < 1 ? 5 : 2) : 'Enter a value'}</strong><span>{market ? `${market.source} · ${new Date(market.observedAt).toLocaleTimeString()}` : 'No market observation loaded'}</span></div>
            <span className={marketError ? 'data-state bad' : priceOverride ? 'data-state neutral' : stale ? 'data-state stale' : market ? 'data-state good' : 'data-state neutral'}>{marketError ? 'Source error' : priceOverride ? 'User supplied' : stale ? 'Stale · refresh' : market ? 'Observed' : 'Manual input'}</span>
          </div>
          {(marketError || chainError) && <div className="inline-note error"><span>{marketError ? `Market source: ${marketError}` : chainError}</span><button onClick={() => marketError ? void refreshMarket(symbol) : void readChainStatus().then(setChainStatus).catch((error: Error) => setChainError(error.message))}>Retry</button></div>}
          <div className="work-grid">
            <section className="thesis-pane" aria-labelledby="thesis-title">
              <div className="section-heading"><h2 id="thesis-title">The setup</h2><span className="section-number">01</span></div>
              <label className="field-label" htmlFor="report-title">Name this rehearsal</label><input className="text-input" id="report-title" maxLength={80} placeholder="e.g. BTC weekly range break" value={title} onChange={(event) => setTitle(event.target.value)}/>
              <label className="field-label" htmlFor="thesis">Thesis note</label><textarea id="thesis" className="thesis-input" maxLength={1000} placeholder="What would need to happen for this idea to hold?" value={thesis} onChange={(event) => setThesis(event.target.value)}/><div className="char-count">{thesis.length}/1,000</div>
              <div className="field-grid"><label className="field-label" htmlFor="entry">Reference price <span className="field-unit">USD</span><input id="entry" className="number-input" type="number" min="0.00001" step="any" value={input.entry || ''} placeholder="User-entered" onChange={(event) => { setPriceOverride(true); update({ entry: Number(event.target.value) }) }}/></label>
              <label className="field-label" htmlFor="direction">Thesis direction<select id="direction" className="number-input" value={input.direction} onChange={(event) => update({ direction: event.target.value as ScenarioInput['direction'] })}><option value="up">Price rises</option><option value="down">Price falls</option></select></label></div>
              <div className="section-heading assumptions-heading"><h2>Scenario assumptions</h2><span className="section-number">02</span></div>
              <label className="range-label" htmlFor="endpoint">Thesis endpoint <strong>{input.direction === 'up' ? '+' : '−'}{fmt(Math.abs(input.endpointPct))}%</strong></label><input id="endpoint" className="range" type="range" min="1" max="40" step="1" value={Math.abs(input.endpointPct)} onChange={(event) => update({ endpointPct: Number(event.target.value) })}/>
              <label className="range-label" htmlFor="adverse">Adverse excursion <strong>{fmt(input.adversePct)}%</strong></label><input id="adverse" className="range ochre" type="range" min="0" max="50" step="1" value={input.adversePct} onChange={(event) => update({ adversePct: Number(event.target.value) })}/>
              <div className="field-grid lower-fields"><label className="field-label" htmlFor="horizon">Time horizon<input id="horizon" className="number-input" type="number" min="1" max="8760" step="1" value={input.horizonHours} onChange={(event) => update({ horizonHours: Number(event.target.value) })}/></label><label className="field-label" htmlFor="cost">Round-trip cost <span className="field-unit">assumption</span><input id="cost" className="number-input" type="number" min="0" max="10" step="0.01" value={input.feePct} onChange={(event) => update({ feePct: Number(event.target.value) })}/></label></div>
              <p className="hint">Cost is a user-set estimate, not a quote. Scenarios are deterministic illustrations, not forecasts.</p>
              {errors.length > 0 && input.entry > 0 && <p className="field-error" role="alert">{errors[0]}</p>}
              <div className="form-actions"><button className="primary-button" disabled={busy !== null || errors.length > 0 || !thesis.trim()} onClick={() => void saveReport()}>{busy === 'save' ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>} Save rehearsal</button><button className="icon-control" title="Export current rehearsal JSON" aria-label="Export current rehearsal JSON" onClick={() => { const artifact = buildArtifact(input, thesis, symbol, !priceOverride ? market?.observedAt ?? null : null, crypto.randomUUID()); const blob = new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `drift-${symbol}-rehearsal.json`; link.click(); URL.revokeObjectURL(link.href) }}><ArrowDownToLine size={17}/></button></div>
            </section>

            <section className="analysis-pane" aria-labelledby="path-title">
              <div className="section-heading chart-heading"><div><h2 id="path-title">Path comparison</h2><p>Same starting reference · distinct hypothetical journeys</p></div><button className="icon-control" title="Refresh public market reference" aria-label="Refresh public market reference" onClick={() => void refreshMarket(symbol)} disabled={marketLoading}><RefreshCw className={marketLoading ? 'spin' : ''} size={16}/></button></div>
              <div className="chart-legend">{[['baseline','Baseline','#90C9DE'],['shock','Adverse first','#D9AF5E'],['delay','Delayed thesis','#A7AAA9']].map(([id,label,color])=><button key={id} className={visibleLines.includes(id) ? 'legend-button' : 'legend-button muted'} onClick={() => setVisibleLines((lines) => lines.includes(id) ? lines.filter((item) => item !== id) : [...lines,id])}><i style={{ '--line-color': color } as React.CSSProperties}/>{label}</button>)}</div>
              <ScenarioChart scenarios={scenarios} visible={visibleLines} entry={input.entry}/>
              <div className="chart-foot"><span><Clock3 size={13}/> {input.horizonHours > 0 ? `${input.horizonHours}h scenario window` : 'Set a valid time horizon'}</span><span>{priceOverride ? `Manual price · last public observation ${market ? new Date(market.observedAt).toLocaleString() : 'none'}` : market ? `Reference observed ${new Date(market.observedAt).toLocaleString()}` : 'Price input is user-supplied'}</span></div>
              <div className="assumption-table-wrap"><table className="assumption-table"><caption>Path outcomes · subtracting {fmt(input.feePct)}% user-set cost</caption><thead><tr><th scope="col">Path</th><th scope="col">Modeled route</th><th scope="col">Price at end</th><th scope="col">Directional change¹</th></tr></thead><tbody>{scenarios.map((scenario) => <tr key={scenario.id}><th scope="row"><span className="row-dot" style={{ '--line-color': scenario.color } as React.CSSProperties}/>{scenario.label}</th><td>{scenario.id === 'baseline' ? 'Gradual thesis move' : scenario.id === 'shock' ? `${fmt(input.adversePct)}% adverse, then recover` : 'Adverse delay, partial progress'}</td><td className="mono">{scenario.endpointPct > 0 ? '+' : ''}{fmt(scenario.endpointPct)}%</td><td className="mono">{scenario.netDirectionPct > 0 ? '+' : ''}{fmt(scenario.netDirectionPct)}%</td></tr>)}</tbody></table><p className="table-note">¹ Illustrative percent change in the stated thesis direction after the assumed round-trip cost; unit exposure only, no position sizing.</p></div>
              <div className="chart-disclaimer"><ShieldCheck size={15}/><span>Path math is modeled from the inputs at left. It does not predict price movement or account for liquidity, slippage, or liquidation.</span></div>
            </section>
          </div>
          {activeReport && <section className="saved-bar"><div><Check size={16}/><div><strong>{activeReport.title}</strong><span>Artifact ready · {activeReport.artifact.schema}</span></div></div><button className="quiet-button" onClick={() => anchorReport(activeReport)} disabled={busy !== null || Boolean(activeReport.chainTx) || !CONTRACT_ADDRESS}>{busy === 'anchor' ? <LoaderCircle className="spin" size={15}/> : activeReport.chainTx ? <Check size={15}/> : <Layers3 size={15}/>} {activeReport.chainTx ? 'Anchored' : 'Anchor commitment'}</button></section>}
        </>}

        {tab === 'compare' && <ComparePage reports={compare} selectedCount={selected.length} onOpen={setActiveReport} onExport={exportReport}/ >}
        {tab === 'library' && <section className="library-page"><div className="page-heading"><div><h1>Library</h1><p>Saved rehearsals stay in this browser and wallet scope.</p></div><button className="quiet-button" onClick={newRehearsal}><FilePlus2 size={16}/> New rehearsal</button></div><div className="library-tools"><label className="searchbox"><Search size={16}/><input aria-label="Search rehearsals" placeholder="Search name, thesis, market" value={query} onChange={(event) => setQuery(event.target.value)}/>{query && <button title="Clear search" aria-label="Clear search" onClick={() => setQuery('')}><X size={14}/></button>}</label><label className="filter-select"><Filter size={15}/><select aria-label="Filter by on-chain status" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">All rehearsals</option><option value="anchored">Anchored</option><option value="local">Local only</option></select><ChevronDown size={14}/></label><button className="quiet-button" onClick={() => { if (selected.length < 2) setMessage({ type: 'info', text: 'Choose at least two saved rehearsals to compare.' }); else setTab('compare') }} disabled={selected.length === 0}><GitCompareArrows size={15}/> Compare {selected.length > 0 ? `(${selected.length})` : ''}</button></div>
          {filtered.length === 0 ? <div className="empty-state"><Layers3 size={22}/><h2>{reports.length ? 'No matches' : 'No saved rehearsals yet'}</h2><p>{reports.length ? 'Try another name or filter.' : 'Save a rehearsal to keep its inputs, source timestamp, assumptions, and artifact hashable.'}</p>{reports.length === 0 && <button className="primary-button" onClick={newRehearsal}>Start a rehearsal</button>}</div> : <div className="report-list">{filtered.map((report) => <article key={report.id} className="report-row"><label className="select-report"><input type="checkbox" aria-label={`Select ${report.title} for comparison`} checked={selected.includes(report.id)} disabled={!selected.includes(report.id) && selected.length >= 3} onChange={(event) => setSelected((items) => event.target.checked ? [...items, report.id] : items.filter((id) => id !== report.id))}/></label><button className="report-summary" onClick={() => { setActiveReport(report); setTab('rehearse'); setTitle(report.title); setThesis(report.artifact.thesis); setSymbol(report.symbol); setInput({ entry: report.artifact.reference.price, direction: report.artifact.reference.direction, endpointPct: report.artifact.assumptions.thesisEndpointPct, adversePct: report.artifact.assumptions.adverseMovePct, horizonHours: report.artifact.assumptions.horizonHours, feePct: report.artifact.assumptions.estimatedRoundTripCostPct }); setPriceOverride(report.artifact.reference.observedAt === null); setMarket(report.artifact.reference.observedAt ? { symbol: report.symbol, price: report.artifact.reference.price, observedAt: report.artifact.reference.observedAt, source: 'Bitget public ticker snapshot' } : null) }}><span className="report-title">{report.title}</span><span>{report.symbol} · {new Date(report.savedAt).toLocaleString()}</span><span className="report-thesis">{report.artifact.thesis || 'No thesis note'}</span></button><span className={report.chainTx ? 'anchor-state anchored' : 'anchor-state'}>{report.chainTx ? <><Check size={14}/> Anchored</> : <><Clock3 size={14}/> Local only</>}</span><button className="icon-control" title="Export rehearsal JSON" aria-label={`Export ${report.title}`} onClick={() => exportReport(report)}><ArrowDownToLine size={16}/></button></article>)}</div>}
        </section>}
      </section>

      <footer className="footer"><span><img src="/drift-mark.svg" alt="" width="16" height="16"/> Drift · Scenario rehearsal notebook</span><span>Read-only market reference · no trade execution</span></footer>
    </main>

    {message && <div className={`toast ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}><span>{message.text}{message.tx && <a href={`${BOT.explorer}/tx/${message.tx}`} target="_blank" rel="noreferrer">View transaction <ArrowUp size={13}/></a>}</span><button aria-label="Dismiss message" onClick={() => setMessage(null)}><X size={15}/></button></div>}
    {walletError && <div className="toast error" role="alert"><span>{walletError}</span><button aria-label="Dismiss wallet notice" onClick={() => setWalletError('')}><X size={15}/></button></div>}
    {wallet && <div className="wallet-context" role="status"><LockKeyhole size={13}/> Wallet connected · {short(wallet.account, 7, 5)} · {wallet.chainId === BOT.chainId ? 'BOT Chain Testnet' : `Chain ${wallet.chainId}`}</div>}
  </div>
}

function ScenarioChart({ scenarios, visible, entry }: { scenarios: ReturnType<typeof buildScenarios>; visible: string[]; entry: number }) {
  if (!scenarios.length || entry <= 0) return <div className="chart-empty"><Activity size={26}/><strong>Enter a reference price to plot scenarios</strong><span>The paths are hypothetical and update with your assumptions.</span></div>
  const visibleScenarios = scenarios.filter((scenario) => visible.includes(scenario.id))
  if (!visibleScenarios.length) return <div className="chart-empty"><SlidersHorizontal size={24}/><strong>All paths are hidden</strong><span>Choose a path in the legend to show it.</span></div>
  const all = visibleScenarios.flatMap((scenario) => scenario.values)
  const low = Math.min(...all), high = Math.max(...all), pad = Math.max((high - low) * 0.14, entry * 0.006)
  const min = low - pad, max = high + pad
  const X = (index: number) => 58 + index * 255
  const Y = (value: number) => 22 + (1 - (value - min) / (max - min)) * 210
  const grid = [0, 1, 2, 3, 4]
  return <div className="chart-wrap"><svg className="scenario-chart" viewBox="0 0 890 270" role="img" aria-label={`Hypothetical price paths from ${fmt(entry)} reference price over ${scenarios[0].values.length - 1} intervals`}>
    {grid.map((_, i) => { const y = 24 + i * 52; const value = max - (max-min) * i/4; return <g key={i}><line x1="58" x2="830" y1={y} y2={y} className="gridline"/><text x="0" y={y+4} className="axis-label">{fmt(value, entry < 1 ? 5 : 0)}</text></g> })}
    {[0,1,2,3].map((i) => <text key={i} x={X(i)} y="258" textAnchor="middle" className="axis-label">{['Start','1/3','2/3','Horizon'][i]}</text>)}
    {entry >= min && entry <= max && <><line x1="58" x2="830" y1={Y(entry)} y2={Y(entry)} className="reference-line"/><text x="838" y={Y(entry)+4} className="reference-tag">REF</text></>}
    {visibleScenarios.map((scenario) => {
      const points = scenario.values.map((value, index) => `${X(index)},${Y(value)}`).join(' ')
      return <g key={scenario.id}><polyline points={points} fill="none" stroke={scenario.color} strokeWidth={scenario.id === 'baseline' ? 3.4 : 2.8} strokeLinecap="round" strokeLinejoin="round" className="scenario-line"/>{scenario.values.map((value,index)=><circle key={`${scenario.id}-${index}`} cx={X(index)} cy={Y(value)} r={index === scenario.values.length-1 ? 4.4 : 2.4} fill={scenario.color} stroke="#191b1e" strokeWidth="1.5"/>)}<text x={X(3)+11} y={Y(scenario.values[3])-6} className="end-label" fill={scenario.color}>{scenario.endpointPct > 0 ? '+' : ''}{fmt(scenario.endpointPct)}%</text></g>
    })}
  </svg></div>
}

function ComparePage({ reports, selectedCount, onOpen, onExport }: { reports: Report[]; selectedCount: number; onOpen: (report: Report) => void; onExport: (report: Report) => void }) {
  return <section className="compare-page"><div className="page-heading"><div><h1>Compare rehearsals.</h1><p>Read the assumptions side by side; the artifacts remain separate.</p></div></div>{reports.length < 2 ? <div className="empty-state"><GitCompareArrows size={24}/><h2>Select two or more rehearsals.</h2><p>Choose up to three from the Library. Each report keeps its own timestamp and assumptions.</p><a href="#/library">Open Library <ArrowUp size={13}/></a></div> : <><div className="compare-meta">Comparing {reports.length} of up to 3 selected rehearsals</div><div className="compare-table-wrap"><table className="compare-table"><thead><tr><th>Rehearsal</th>{reports.map((report) => <th key={report.id}><button onClick={() => onOpen(report)}>{report.title}</button></th>)}</tr></thead><tbody>{[
    ['Market', (r: Report) => r.symbol], ['Reference', (r: Report) => `${fmt(r.artifact.reference.price, r.artifact.reference.price < 1 ? 5 : 2)} ${r.artifact.reference.source}`], ['Thesis', (r: Report) => r.artifact.thesis], ['Thesis endpoint', (r: Report) => `${r.artifact.assumptions.thesisEndpointPct}%`], ['Adverse move', (r: Report) => `${r.artifact.assumptions.adverseMovePct}%`], ['Horizon', (r: Report) => `${r.artifact.assumptions.horizonHours}h`], ['Cost estimate', (r: Report) => `${r.artifact.assumptions.estimatedRoundTripCostPct}%`], ['Saved', (r: Report) => new Date(r.savedAt).toLocaleString()], ['On-chain state', (r: Report) => r.chainTx ? `Anchored · ${short(r.chainTx)}` : 'Browser only'],
  ].map(([label, get])=><tr key={label as string}><th scope="row">{label as string}</th>{reports.map((report)=><td key={report.id}>{(get as (r:Report)=>string)(report)}</td>)}</tr>)}</tbody></table></div><div className="compare-actions">{reports.map((r)=><button className="quiet-button" key={r.id} onClick={() => onExport(r)}><ArrowDownToLine size={15}/> Export {r.symbol}</button>)}</div></>}</section>
}
