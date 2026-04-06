import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { i18n } from '@kbn/i18n';
import { I18nProvider } from '@kbn/i18n-react';
import { BrowserRouter as Router } from '@kbn/shared-ux-router';
import {
  EuiBadge,
  EuiBasicTable,
  EuiButton,
  EuiCallOut,
  EuiEmptyPrompt,
  EuiFieldSearch,
  EuiLoadingSpinner,
  EuiPageTemplate,
  EuiSelect,
  EuiSpacer,
  EuiText,
  EuiButtonIcon,
  EuiIcon,
} from '@elastic/eui';
import type { EuiBasicTableColumn } from '@elastic/eui';
import {
  Axis,
  BarSeries,
  Chart,
  CurveType,
  LineSeries,
  Position,
  ScaleType,
  Settings,
  Tooltip,
  LIGHT_THEME,
} from '@elastic/charts';
import type { CoreStart } from '@kbn/core/public';
import type { NavigationPublicPluginStart } from '@kbn/navigation-plugin/public';

import { PLUGIN_ID } from '../../common';
import type { AlertSeverity, DashboardMetrics, SecurityAlert } from '../../common/types';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface TlsocPluginAppDeps {
  basename: string;
  notifications: CoreStart['notifications'];
  http: CoreStart['http'];
  navigation: NavigationPublicPluginStart;
}

type WindowValue =
  | 'now/d'
  | 'now-15m'
  | 'now-30m'
  | 'now-1h'
  | 'now-6h'
  | 'now-24h'
  | 'now-1w'
  | 'now-2w'
  | 'now-30d'
  | 'now-60d'
  | 'now-90d';

interface RecentAlertRow {
  id: string;
  timestamp: string;
  severity: AlertSeverity;
  ruleName: string;
  userName: string;
  server: string;
  status: string;
}

interface MitreTacticRow {
  id: string;
  tactic: string;
  technique: string;
  count: number;
  severity: AlertSeverity;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const WINDOW_OPTIONS: Array<{ value: WindowValue; text: string }> = [
  { value: 'now/d',   text: 'Present (Today)' },
  { value: 'now-15m', text: 'Last 15 minutes' },
  { value: 'now-30m', text: 'Last 30 minutes' },
  { value: 'now-1h',  text: 'Last 1 hour' },
  { value: 'now-6h',  text: 'Last 6 hours' },
  { value: 'now-24h', text: 'Last 24 hours' },
  { value: 'now-1w',  text: 'Last 7 days' },
  { value: 'now-2w',  text: 'Last 2 weeks' },
  { value: 'now-30d', text: 'Last 30 days' },
  { value: 'now-60d', text: 'Last 60 days' },
  { value: 'now-90d', text: 'Last 90 days' },
];

const LIVE_REFRESH_MS = 5000;

// Dark-blue chart theme compatible with @elastic/charts
const DARK_CHART_THEME = {
  ...LIGHT_THEME,
  background: { color: 'transparent' },
  axes: {
    ...LIGHT_THEME.axes,
    tickLabel: { ...LIGHT_THEME.axes.tickLabel, fill: '#8ab4d8', fontSize: 10 },
    axisLine:  { stroke: 'rgba(59,130,246,0.2)' },
    gridLine: {
      horizontal: { stroke: 'rgba(59,130,246,0.1)', strokeWidth: 1 },
      vertical:   { stroke: 'rgba(59,130,246,0.05)', strokeWidth: 1 },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Animated counter hook
// ─────────────────────────────────────────────────────────────────────────────
function useCountUp(target: number, duration = 900): number {
  const [val, setVal] = useState(0);
  const raf = useRef<number>(0);
  useEffect(() => {
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      setVal(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);
  return val;
}

// ─────────────────────────────────────────────────────────────────────────────
// MetricCard sub-component
// ─────────────────────────────────────────────────────────────────────────────
const MetricCard: React.FC<{
  label: string; subtitle: string; value: number;
  variant: 'critical' | 'high' | 'medium' | 'low'; delay: number;
}> = ({ label, subtitle, value, variant, delay }) => {
  const animated = useCountUp(value);
  return (
    <div className={`tlsocMetricCard tlsocMetricCard--${variant}`} style={{ animationDelay: `${delay}ms` }}>
      <div className="tlsocMetricGlow" />
      <div className="tlsocMetricCardInner">
        <div className="tlsocMetricHeader">
          <span className="tlsocMetricTitle">{label}</span>
          <EuiIcon type="alert" className="tlsocMetricIcon" />
        </div>
        <div className="tlsocMetricSubtitle">{subtitle}</div>
        <div className="tlsocMetricValue">{value === 0 ? '0' : animated.toLocaleString()}</div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────────────────────────────
export const TlsocPluginApp = ({ basename, notifications, http, navigation }: TlsocPluginAppDeps) => {
  const [dashboard,    setDashboard]    = useState<DashboardMetrics | null>(null);
  const [windowFrom,   setWindowFrom]   = useState<WindowValue>('now-1w');
  const [lastUpdated,  setLastUpdated]  = useState<string>('');
  const [isLoading,    setIsLoading]    = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error,        setError]        = useState<string>('');
  const [kqlQuery,     setKqlQuery]     = useState<string>('');
  const [clock,        setClock]        = useState<string>('');

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('en-GB')), 1000);
    setClock(new Date().toLocaleTimeString('en-GB'));
    return () => clearInterval(t);
  }, []);

  // ── API CALL ──────────────────────────────────────────────────────────────
  // Calls your real Kibana server-side route:
  //    GET /api/tlsoc_plugin/dashboard/metrics?from_date=now-15m&to_date=now
  //    (defined in server/routes/index.ts)
  //
  // NOTE: When windowFrom === 'now/d' (Present / Today), from_date is sent as
  //       'now/d' which Elasticsearch rounds down to the start of the current
  //       day (midnight UTC), giving you all alerts from today so far.
  const loadDashboard = useCallback(
    async (silent = false) => {
      silent ? setIsRefreshing(true) : setIsLoading(true);
      setError('');
      try {
        const query = { from_date: windowFrom, to_date: 'now' };
        const res   = await http.get('/api/tlsoc_plugin/dashboard/metrics', { query });
        setDashboard(res as DashboardMetrics);
        setLastUpdated(new Date().toLocaleTimeString());
      } catch (err) {
        const msg = err instanceof Error
          ? err.message
          : i18n.translate('tlsocPlugin.dashboardUnknownError', { defaultMessage: 'Unknown error' });
        setError(msg);
        notifications.toasts.addDanger({
          title: i18n.translate('tlsocPlugin.dashboardLoadFailed', { defaultMessage: 'Failed to load dashboard' }),
          text:  msg,
        });
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [http, notifications.toasts, windowFrom]
  );

  // Initial load + reload on window change
  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  // Auto-refresh every 5 s
  useEffect(() => {
    const t = window.setInterval(() => loadDashboard(true), LIVE_REFRESH_MS);
    return () => window.clearInterval(t);
  }, [loadDashboard]);

  // ── Derived data ─────────────────────────────────────────────────────────
  const severityCounts = useMemo(() => {
    const init: Record<AlertSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    return (dashboard?.bySeverity ?? []).reduce(
      (acc, item) => { acc[item.severity] = item.count; return acc; }, { ...init }
    );
  }, [dashboard]);

  const trendBase = useMemo(
    () => (dashboard?.alertsOverTime ?? []).map((p, i) => ({
      x: p.timestamp || `t-${i}`,
      y: Number.isFinite(p.count) ? p.count : 0,
    })),
    [dashboard]
  );

  const severityBarData = useMemo(() => [
    { label: 'Critical', count: severityCounts.critical },
    { label: 'High',     count: severityCounts.high },
    { label: 'Medium',   count: severityCounts.medium },
    { label: 'Low',      count: severityCounts.low },
  ], [severityCounts]);

  const recentAlertRows = useMemo<RecentAlertRow[]>(
    () => (dashboard?.recentHighRisk ?? []).slice(0, 20).map((row: SecurityAlert, i) => ({
      id:        `a${i}`,
      timestamp: row.timestamp,
      severity:  row.severity,
      ruleName:  row.ruleName,
      userName:  row.userName       || '-',
      server:    row.observerServer || '-',
      status:    row.workflowStatus,
    })),
    [dashboard]
  );

  const mitreTactics = useMemo<MitreTacticRow[]>(() => {
    const map: Record<string, MitreTacticRow> = {};
    (dashboard?.recentHighRisk ?? []).forEach((row: SecurityAlert, i) => {
      const tactic    = row.mitreTactics?.[0]?.name    || 'Unknown';
      const technique = row.mitreTechniques?.[0]?.name || row.ruleName;
      const key       = `${tactic}::${technique}`;
      if (map[key]) map[key].count += 1;
      else          map[key] = { id: `m${i}`, tactic, technique, count: 1, severity: row.severity };
    });
    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [dashboard]);

  const totalAlerts = severityCounts.critical + severityCounts.high + severityCounts.medium + severityCounts.low;

  // ── Table columns ────────────────────────────────────────────────────────
  const alertColumns: Array<EuiBasicTableColumn<RecentAlertRow>> = [
    {
      field: 'timestamp', name: 'Time', width: '130px',
      render: (v: string) => (
        <span className="tlsocMono tlsocTextMuted">
          {new Date(v).toLocaleTimeString('en-GB', { hour12: false })}
        </span>
      ),
    },
    {
      field: 'severity', name: 'Sev', width: '88px',
      render: (v: AlertSeverity) => (
        <EuiBadge className={`tlsocSevBadge tlsocSevBadge--${v}`}>{v.toUpperCase()}</EuiBadge>
      ),
    },
    { field: 'ruleName', name: 'Rule', truncateText: true },
    { field: 'userName', name: 'User',   width: '108px', render: (v: string) => <span className="tlsocMono">{v}</span> },
    { field: 'server',   name: 'Server', width: '120px', render: (v: string) => <span className="tlsocMono">{v}</span> },
    {
      field: 'status', name: 'Status', width: '108px',
      render: (v: string) => (
        <EuiBadge className={`tlsocStatusBadge tlsocStatusBadge--${v}`}>{v}</EuiBadge>
      ),
    },
  ];

  const mitreColumns: Array<EuiBasicTableColumn<MitreTacticRow>> = [
    { field: 'tactic',    name: 'Tactic' },
    { field: 'technique', name: 'Technique', truncateText: true },
    {
      field: 'severity', name: 'Sev', width: '70px',
      render: (v: AlertSeverity) => (
        <EuiBadge className={`tlsocSevBadge tlsocSevBadge--${v}`}>{v[0].toUpperCase()}</EuiBadge>
      ),
    },
    { field: 'count', name: '#', width: '52px', render: (v: number) => <strong className="tlsocMono">{v}</strong> },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <Router basename={basename}>
      <I18nProvider>
        <>
          <navigation.ui.TopNavMenu appName={PLUGIN_ID} showSearchBar useDefaultBehaviors />

          <EuiPageTemplate className="tlsocDashboard" restrictWidth={false}>

            {/* ── HERO HEADER */}
            <EuiPageTemplate.Section paddingSize="none" className="tlsocHeroSection">
              <div className="tlsocHeroBg" aria-hidden />
              <div className="tlsocScanLine" aria-hidden />
              <div className="tlsocHeroContent">
                <div className="tlsocHeroLeft">
                  <div className="tlsocLogoOrb">
                    <EuiIcon type="securitySignal" size="l" color="ghost" />
                  </div>
                  <div>
                    <h1 className="tlsocHeroTitle">SOC Security Dashboard</h1>
                    <p className="tlsocHeroSub">Threat Intelligence · Real-time Monitoring</p>
                  </div>
                </div>

                <div className="tlsocHeroRight">
                  <div className="tlsocLivePill">
                    <span className="tlsocLiveDot" />
                    LIVE
                  </div>
                  <div className="tlsocClockBadge">{clock}</div>
                  <EuiFieldSearch
                    placeholder="Filter your data using KQL syntax"
                    value={kqlQuery}
                    onChange={(e) => setKqlQuery(e.target.value)}
                    compressed
                    className="tlsocKqlInput"
                  />
                  <EuiSelect
                    compressed
                    options={WINDOW_OPTIONS}
                    value={windowFrom}
                    onChange={(e) => setWindowFrom(e.target.value as WindowValue)}
                    aria-label="Time window"
                    className="tlsocWindowSelect"
                  />
                  <EuiButton iconType="refresh" size="s" isLoading={isRefreshing}
                    onClick={() => loadDashboard(true)} className="tlsocRefreshBtn" fill>
                    Refresh
                  </EuiButton>
                  {lastUpdated && (
                    <EuiBadge color="hollow" className="tlsocTimeBadge">{lastUpdated}</EuiBadge>
                  )}
                </div>
              </div>
            </EuiPageTemplate.Section>

            <EuiPageTemplate.Section className="tlsocMainSection">

              {/* Loading */}
              {isLoading && !dashboard && (
                <div className="tlsocLoadingWrap">
                  <EuiLoadingSpinner size="xl" />
                  <EuiText size="s" color="subdued"><p>Loading threat data…</p></EuiText>
                </div>
              )}

              {/* Error */}
              {!isLoading && error && (
                <EuiCallOut title="Unable to load dashboard" color="danger" iconType="alert">
                  <p>{error}</p>
                </EuiCallOut>
              )}

              {dashboard && (
                <>
                  {/* ── METRIC CARDS */}
                  <div className="tlsocMetricRow">
                    <MetricCard label="criticial" subtitle="count()"          value={severityCounts.critical} variant="critical" delay={0}   />
                    <MetricCard label="HIGH"       subtitle="Count of records" value={severityCounts.high}     variant="high"     delay={80}  />
                    <MetricCard label="Medium"     subtitle="count()"          value={severityCounts.medium}   variant="medium"   delay={160} />
                    <MetricCard label="low"        subtitle="count()"          value={severityCounts.low}      variant="low"      delay={240} />
                  </div>

                  <EuiSpacer size="m" />

                  {/* ── ALERT TRAFFIC */}
                  <div className="tlsocPanel tlsocPanelFade" style={{ '--delay': '0.3s' } as React.CSSProperties}>
                    <div className="tlsocPanelHeader">
                      <div className="tlsocPanelTitle">
                        <span className="tlsocPulse" />
                        Alert Traffic
                      </div>
                      <div className="tlsocLegendRow">
                        {(['low', 'medium', 'high', 'critical'] as AlertSeverity[]).map((sev) => (
                          <div key={sev} className="tlsocLegendItem">
                            <span className={`tlsocLegendDot tlsocLegendDot--${sev}`} />
                            <span className="tlsocLegendLabel">{sev}</span>
                            <span className="tlsocLegendCount">
                              {sev === 'low' ? severityCounts.low : sev === 'medium' ? severityCounts.medium : sev === 'high' ? severityCounts.high : severityCounts.critical}
                            </span>
                          </div>
                        ))}
                        <EuiButtonIcon iconType="boxesHorizontal" aria-label="chart options" size="xs" color="text" />
                      </div>
                    </div>

                    <div className="tlsocChartArea" style={{ height: 230 }}>
                      {trendBase.length > 0 ? (
                        <Chart>
                          <Settings theme={DARK_CHART_THEME} showLegend={false} />
                          <Axis id="tb" position={Position.Bottom} tickFormat={(v) => String(v)} />
                          <Axis id="tl" position={Position.Left} />
                          <Tooltip />
                          <LineSeries id="total" name="total" xScaleType={ScaleType.Ordinal} yScaleType={ScaleType.Linear} curve={CurveType.CURVE_MONOTONE_X} xAccessor="x" yAccessors={['y']} data={trendBase} color="#4ea1ff" lineSeriesStyle={{ line: { strokeWidth: 2.5 }, point: { visible: false } }} />
                        </Chart>
                      ) : (
                        <EuiEmptyPrompt iconType="visualizeApp" title={<h3>No traffic data</h3>} color="subdued" />
                      )}
                    </div>
                    <div className="tlsocChartFooter">per {LIVE_REFRESH_MS / 1000} seconds · auto-refreshing</div>
                  </div>

                  <EuiSpacer size="m" />

                  {/* ── SEVERITY BAR + SUMMARY */}
                  <div className="tlsocTwoCol">
                    <div className="tlsocPanel tlsocPanelFade" style={{ '--delay': '0.4s' } as React.CSSProperties}>
                      <div className="tlsocPanelHeader">
                        <div className="tlsocPanelTitle"><span className="tlsocPulse" />Severity Distribution</div>
                        <span className="tlsocBadge">{totalAlerts.toLocaleString()} total</span>
                      </div>
                      <div className="tlsocChartArea" style={{ height: 180 }}>
                        {severityBarData.some((d) => d.count > 0) ? (
                          <Chart>
                            <Settings theme={DARK_CHART_THEME} showLegend={false} />
                            <Axis id="sb" position={Position.Bottom} />
                            <Axis id="sl" position={Position.Left} />
                            <Tooltip />
                            <BarSeries
                              id="sev"
                              xScaleType={ScaleType.Ordinal}
                              yScaleType={ScaleType.Linear}
                              xAccessor="label"
                              yAccessors={['count']}
                              data={severityBarData}
                              color="#4ea1ff"
                            />
                          </Chart>
                        ) : (
                          <EuiEmptyPrompt iconType="visBarVertical" title={<h3>No data</h3>} color="subdued" />
                        )}
                      </div>
                    </div>

                    <div className="tlsocPanel tlsocPanelFade" style={{ '--delay': '0.48s' } as React.CSSProperties}>
                      <div className="tlsocPanelHeader">
                        <div className="tlsocPanelTitle">Threat Summary</div>
                      </div>
                      <div className="tlsocSummaryGrid">
                        {[
                          { label: 'Total Alerts',    value: totalAlerts.toLocaleString(),                                                   icon: 'bell' as const },
                          { label: 'Critical + High', value: (severityCounts.critical + severityCounts.high).toLocaleString(),               icon: 'alert' as const },
                          { label: 'Window',          value: WINDOW_OPTIONS.find((w) => w.value === windowFrom)?.text ?? '',                 icon: 'clock' as const },
                          { label: 'Auto-refresh',    value: `${LIVE_REFRESH_MS / 1000}s`,                                                   icon: 'refresh' as const },
                        ].map((item) => (
                          <div key={item.label} className="tlsocSummaryItem">
                            <EuiIcon type={item.icon} className="tlsocSummaryIcon" />
                            <div>
                              <div className="tlsocSummaryLabel">{item.label}</div>
                              <div className="tlsocSummaryValue">{item.value}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <EuiSpacer size="m" />

                  {/* ── ALERT TABLE + MITRE */}
                  <div className="tlsocTwoCol">
                    <div className="tlsocPanel tlsocPanelFade" style={{ '--delay': '0.55s' } as React.CSSProperties}>
                      <div className="tlsocPanelHeader">
                        <div className="tlsocPanelTitle"><span className="tlsocPulse" />alerttable_timeseries_</div>
                        <span className="tlsocBadge">{recentAlertRows.length} rows</span>
                      </div>
                      {recentAlertRows.length > 0 ? (
                        <EuiBasicTable
                          items={recentAlertRows}
                          columns={alertColumns}
                          rowProps={(row) => ({ className: `tlsocAlertRow tlsocAlertRow--${row.severity}` })}
                          tableLayout="auto"
                          className="tlsocTable"
                        />
                      ) : (
                        <EuiEmptyPrompt iconType="visTable" title={<h3>No results found</h3>} color="subdued" />
                      )}
                    </div>

                    <div className="tlsocPanel tlsocPanelFade" style={{ '--delay': '0.62s' } as React.CSSProperties}>
                      <div className="tlsocPanelHeader">
                        <div className="tlsocPanelTitle"><span className="tlsocPulse tlsocPulse--amber" />mitre tactics</div>
                        <span className="tlsocBadge">{mitreTactics.length} tactics</span>
                      </div>
                      {mitreTactics.length > 0 ? (
                        <EuiBasicTable
                          items={mitreTactics}
                          columns={mitreColumns}
                          tableLayout="auto"
                          className="tlsocTable"
                        />
                      ) : (
                        <EuiEmptyPrompt iconType="visTable" title={<h3>No results found</h3>} color="subdued" />
                      )}
                    </div>
                  </div>
                </>
              )}
            </EuiPageTemplate.Section>
          </EuiPageTemplate>
        </>
      </I18nProvider>
    </Router>
  );
};