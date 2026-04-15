import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { i18n } from '@kbn/i18n';
import { I18nProvider } from '@kbn/i18n-react';
import { BrowserRouter as Router } from '@kbn/shared-ux-router';
import {
  EuiBadge,
  EuiBasicTable,
  EuiButton,
  EuiCodeBlock,
  EuiCallOut,
  EuiDescriptionList,
  EuiEmptyPrompt,
  EuiLoadingSpinner,
  EuiSelect,
  EuiIcon,
} from '@elastic/eui';
import type { EuiBasicTableColumn } from '@elastic/eui';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip as ChartTooltip,
  Legend,
  type ChartOptions,
  type ChartData,
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import type { CoreStart } from '@kbn/core/public';
import type { NavigationPublicPluginStart } from '@kbn/navigation-plugin/public';

import { PLUGIN_ID } from '../../common';
import type { AlertSeverity, DashboardMetrics, SecurityAlert } from '../../common/types';

ChartJS.register(
  CategoryScale, LinearScale, RadialLinearScale,
  PointElement, LineElement, BarElement, ArcElement,
  Filler, ChartTooltip, Legend
);

// Types
interface TlsocPluginAppDeps {
  basename: string;
  notifications: CoreStart['notifications'];
  http: CoreStart['http'];
  navigation: NavigationPublicPluginStart;
}

type WindowValue =
  | 'now/d' | 'now-15m' | 'now-30m' | 'now-1h'
  | 'now-6h' | 'now-24h' | 'now-1w' | 'now-2w'
  | 'now-30d' | 'now-60d' | 'now-90d';

interface RecentAlertRow {
  id: string; alertUuid: string; timestamp: string;
  severity: AlertSeverity; ruleName: string; userName: string;
  server: string; status: string; sourceIp: string;
  destinationIp: string; eventPayload: string; mitre: string; eventId: string;
  eventOriginal: string; signalStatus: string; mitreTacticName: string;
}

interface MitreTacticRow {
  id: string; tactic: string; technique: string;
  count: number; severity: AlertSeverity;
}

interface AlertDetailsResponse {
  alertUuid: string; timestamp: string; ruleName: string;
  sourceIp: string; destinationIp: string;
  server?: string;
  eventPayload: string; mitre: string; eventId: string;
  eventOriginal?: string; signalStatus?: string; mitreTacticName?: string;
}

const WINDOW_OPTIONS: Array<{ value: WindowValue; text: string }> = [
  { value: 'now/d',   text: 'Today' },
  { value: 'now-15m', text: '15 min' },
  { value: 'now-30m', text: '30 min' },
  { value: 'now-1h',  text: '1 hour' },
  { value: 'now-6h',  text: '6 hours' },
  { value: 'now-24h', text: '24 hours' },
  { value: 'now-1w',  text: '7 days' },
  { value: 'now-2w',  text: '2 weeks' },
  { value: 'now-30d', text: '30 days' },
  { value: 'now-60d', text: '60 days' },
  { value: 'now-90d', text: '90 days' },
];

const LIVE_REFRESH_MS = 60000;
const DEFAULT_WINDOW_FROM: WindowValue = 'now-90d';

const DASHBOARD_CSS = `
.soc-root[data-theme="dark"] {
  --bg:           #060e1f;
  --bg2:          #0a1628;
  --surface:      #0d1e38;
  --surface2:     #112244;
  --border:       rgba(59,130,246,0.15);
  --border2:      rgba(59,130,246,0.08);
  --text:         #e2eeff;
  --text2:        #7ca3d4;
  --text3:        #3d6490;
  --accent:       #3b82f6;
  --accent2:      #60a5fa;
  --accent-glow:  rgba(59,130,246,0.22);
  --critical:     #f87171;
  --high:         #fb923c;
  --medium:       #fbbf24;
  --low:          #34d399;
  --shadow:       0 8px 32px rgba(0,0,0,0.5);
  --shadow-sm:    0 2px 12px rgba(0,0,0,0.4);
  --mesh1: rgba(59,130,246,0.07);
  --mesh2: rgba(99,102,241,0.05);
}

.soc-root[data-theme="light"] {
  --bg:           #eef4ff;
  --bg2:          #e0eafc;
  --surface:      #ffffff;
  --surface2:     #f0f6ff;
  --border:       rgba(59,130,246,0.18);
  --border2:      rgba(59,130,246,0.10);
  --text:         #0f2048;
  --text2:        #3a5a90;
  --text3:        #7aa0cc;
  --accent:       #2563eb;
  --accent2:      #3b82f6;
  --accent-glow:  rgba(37,99,235,0.18);
  --critical:     #dc2626;
  --high:         #ea580c;
  --medium:       #b45309;
  --low:          #059669;
  --shadow:       0 8px 32px rgba(37,99,235,0.1);
  --shadow-sm:    0 2px 12px rgba(37,99,235,0.08);
  --mesh1: rgba(59,130,246,0.05);
  --mesh2: rgba(99,102,241,0.04);
}

.soc-root, .soc-root * { box-sizing: border-box; }
.soc-root {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  position: relative;
}

.soc-root {
  transition: background 0.45s ease, color 0.45s ease;
}
.soc-root .soc-header,
.soc-root .soc-panel,
.soc-root .soc-metric,
.soc-root .soc-summary-item {
  transition: background 0.45s ease, border-color 0.45s ease, box-shadow 0.25s ease;
}

.soc-bg-mesh {
  position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden;
}
.soc-bg-blob {
  position: absolute; border-radius: 50%; filter: blur(80px);
  animation: blobFloat 12s ease-in-out infinite;
}
.soc-bg-blob:nth-child(1) {
  width: 500px; height: 500px; top: -120px; left: -100px;
  background: radial-gradient(circle, var(--mesh1), transparent 70%);
  animation-delay: 0s;
}
.soc-bg-blob:nth-child(2) {
  width: 420px; height: 420px; bottom: -80px; right: -80px;
  background: radial-gradient(circle, var(--mesh2), transparent 70%);
  animation-delay: -6s;
}
@keyframes blobFloat {
  0%,100% { transform: translate(0,0) scale(1); }
  33%     { transform: translate(30px,-20px) scale(1.05); }
  66%     { transform: translate(-20px,15px) scale(0.97); }
}

.soc-header {
  position: sticky; top: 0; z-index: 100;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
.soc-header-inner {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 28px; gap: 16px; flex-wrap: wrap;
}
.soc-header-left  { display: flex; align-items: center; gap: 16px; }
.soc-header-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.soc-logo {
  width: 46px; height: 46px; border-radius: 12px;
  background: linear-gradient(135deg, #3b82f6, #6366f1);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.12), 0 4px 18px var(--accent-glow);
  animation: logoBounce 0.7s cubic-bezier(0.175,0.885,0.32,1.275) both;
  flex-shrink: 0;
}
@keyframes logoBounce {
  0%   { opacity:0; transform: scale(0.5) rotate(-15deg); }
  80%  { transform: scale(1.08) rotate(3deg); }
  100% { opacity:1; transform: scale(1) rotate(0); }
}

.soc-title {
  font-size: 22px; font-weight: 800;
  color: var(--text); letter-spacing: -0.4px; margin: 0; line-height: 1.2;
  animation: slideInLeft 0.5s ease both 0.1s;
}
.soc-subtitle {
  font-size: 12px; font-weight: 500; color: var(--text3);
  letter-spacing: 0.8px; margin: 3px 0 0; text-transform: uppercase;
  animation: slideInLeft 0.5s ease both 0.18s;
}
@keyframes slideInLeft {
  from { opacity:0; transform: translateX(-18px); }
  to   { opacity:1; transform: none; }
}

.soc-clock {
  font-family: ui-monospace, 'Courier New', monospace;
  font-size: 17px; font-weight: 600;
  color: var(--accent2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px; padding: 6px 14px;
  letter-spacing: 2px;
  animation: fadeDown 0.5s ease both 0.2s;
}
@keyframes fadeDown {
  from { opacity:0; transform: translateY(-10px); }
  to   { opacity:1; transform: none; }
}

.soc-mode-btn {
  width: 40px; height: 40px; border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  font-size: 18px; line-height: 1;
  transition: all 0.25s cubic-bezier(0.175,0.885,0.32,1.275);
  animation: fadeDown 0.5s ease both 0.25s;
}
.soc-mode-btn:hover {
  background: var(--accent); border-color: var(--accent);
  transform: rotate(20deg) scale(1.12);
  box-shadow: 0 4px 16px var(--accent-glow);
}

.soc-select select {
  background: var(--surface) !important;
  border: 1px solid var(--border) !important;
  color: var(--text) !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
  font-size: 14px !important; font-weight: 500 !important;
  border-radius: 8px !important; padding: 6px 12px !important;
}
.soc-select select:focus {
  border-color: var(--accent) !important;
  box-shadow: 0 0 0 3px var(--accent-glow) !important;
}

.soc-refresh-btn.euiButton--fill {
  background: var(--accent) !important;
  border-color: var(--accent) !important;
  color: #fff !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
  font-size: 14px !important; font-weight: 600 !important;
  border-radius: 8px !important;
  box-shadow: 0 2px 10px var(--accent-glow) !important;
  transition: all 0.2s ease !important;
}
.soc-refresh-btn.euiButton--fill:hover {
  background: var(--accent2) !important;
  transform: translateY(-1px) !important;
  box-shadow: 0 6px 20px var(--accent-glow) !important;
}

.soc-last-upd {
  font-family: ui-monospace, 'Courier New', monospace;
  font-size: 12px; color: var(--text3);
  background: var(--surface);
  border: 1px solid var(--border2);
  border-radius: 6px; padding: 5px 10px;
}

.soc-body {
  position: relative; z-index: 1;
  padding: 24px 28px;
  display: flex; flex-direction: column; gap: 20px;
}

.soc-metrics {
  display: grid; grid-template-columns: repeat(4,1fr); gap: 16px;
}
@media (max-width:900px) { .soc-metrics { grid-template-columns: repeat(2,1fr); } }

.soc-metric {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 24px 26px 20px;
  position: relative; overflow: hidden;
  cursor: default;
  animation: cardRise 0.65s cubic-bezier(0.23,1,0.32,1) both;
}
.soc-metric:hover {
  transform: translateY(-5px) scale(1.01);
  box-shadow: var(--shadow);
}
.soc-metric::before {
  content: '';
  position: absolute; top: 0; left: 0; right: 0; height: 3px;
  background: var(--c);
  border-radius: 18px 18px 0 0;
  opacity: 0.85;
}
.soc-metric-icon-bg {
  position: absolute; right: 18px; bottom: 10px;
  font-size: 60px; opacity: 0.05; line-height: 1;
  transition: opacity 0.3s, transform 0.4s;
  pointer-events: none;
}
.soc-metric:hover .soc-metric-icon-bg { opacity: 0.1; transform: scale(1.12) rotate(6deg); }

@keyframes cardRise {
  from { opacity:0; transform: translateY(28px) scale(0.96); }
  to   { opacity:1; transform: none; }
}
.soc-metrics .soc-metric:nth-child(1) { animation-delay: 0.05s; }
.soc-metrics .soc-metric:nth-child(2) { animation-delay: 0.13s; }
.soc-metrics .soc-metric:nth-child(3) { animation-delay: 0.21s; }
.soc-metrics .soc-metric:nth-child(4) { animation-delay: 0.29s; }

.soc-metric--critical { --c: var(--critical); }
.soc-metric--high     { --c: var(--high); }
.soc-metric--medium   { --c: var(--medium); }
.soc-metric--low      { --c: var(--low); }

.soc-metric-label {
  font-size: 13px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 1.8px; color: var(--c); margin-bottom: 8px;
}
.soc-metric-value {
  font-size: 56px; font-weight: 800;
  color: var(--c); line-height: 1; letter-spacing: -2px;
}
.soc-metric-sub {
  font-size: 13px; color: var(--text3); margin-top: 8px; font-weight: 500;
}

.soc-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 18px; overflow: hidden;
  animation: panelUp 0.55s ease both;
  animation-delay: var(--pd, 0s);
}
.soc-panel:hover { box-shadow: var(--shadow-sm); }
@keyframes panelUp {
  from { opacity:0; transform: translateY(18px); }
  to   { opacity:1; transform: none; }
}
.soc-panel-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px;
  border-bottom: 1px solid var(--border2);
}
.soc-panel-title {
  font-size: 15px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 1.5px; color: var(--text2);
  display: flex; align-items: center; gap: 10px;
}
.soc-panel-badge {
  font-family: ui-monospace, 'Courier New', monospace;
  font-size: 12px; color: var(--accent2);
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 6px; padding: 4px 11px; font-weight: 500;
}
.soc-chart-wrap { padding: 16px 18px; }
.soc-chart-foot {
  font-family: ui-monospace, 'Courier New', monospace;
  font-size: 12px; color: var(--text3);
  padding: 8px 22px 12px;
  border-top: 1px solid var(--border2);
}

.soc-dot {
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--accent); display: inline-block; flex-shrink: 0;
  animation: dotP 2.2s ease-in-out infinite;
}
.soc-dot--warn   { background: var(--high); }
.soc-dot--ok     { background: var(--low); }
.soc-dot--purple { background: #a78bfa; }
@keyframes dotP {
  0%,100% { opacity:1; transform:scale(1); }
  50%     { opacity:0.3; transform:scale(0.65); }
}

.soc-legend { display:flex; align-items:center; gap:16px; }
.soc-legend-item { display:flex; align-items:center; gap:5px; }
.soc-legend-dot { width:9px; height:9px; border-radius:50%; flex-shrink:0; }
.soc-legend-label { font-size:12px; font-weight:600; color:var(--text3); }
.soc-legend-val   { font-size:14px; font-weight:700; color:var(--text); }

.soc-2col { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.soc-3col { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; }
@media (max-width:1200px) { .soc-3col { grid-template-columns:1fr 1fr; } }
@media (max-width:900px)  { .soc-3col,.soc-2col { grid-template-columns:1fr; } }

.soc-summary-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:16px; }
.soc-summary-item {
  display:flex; align-items:flex-start; gap:12px;
  padding:16px; border-radius:12px;
  background:var(--surface2); border:1px solid var(--border2);
  transition: all 0.2s ease;
}
.soc-summary-item:hover { transform:scale(1.03); background:var(--bg2); }
.soc-summary-icon { font-size:22px; opacity:0.8; }
.soc-summary-label {
  font-size:11px; font-weight:700; text-transform:uppercase;
  letter-spacing:1px; color:var(--text3); margin-bottom:5px;
}
.soc-summary-val { font-size:24px; font-weight:800; color:var(--accent2); }

.soc-sev.euiBadge {
  font-family:ui-monospace, 'Courier New', monospace !important;
  font-size:12px !important; font-weight:600 !important;
  letter-spacing:0.5px !important; padding:4px 10px !important;
  border-radius:6px !important; border:1px solid !important;
  text-transform:uppercase !important;
}
.soc-sev--critical.euiBadge { background:rgba(248,113,113,0.12)!important; color:var(--critical)!important; border-color:rgba(248,113,113,0.3)!important; }
.soc-sev--high.euiBadge     { background:rgba(251,146,60,0.12)!important;  color:var(--high)!important;     border-color:rgba(251,146,60,0.3)!important; }
.soc-sev--medium.euiBadge   { background:rgba(251,191,36,0.12)!important;  color:var(--medium)!important;   border-color:rgba(251,191,36,0.3)!important; }
.soc-sev--low.euiBadge      { background:rgba(52,211,153,0.12)!important;  color:var(--low)!important;      border-color:rgba(52,211,153,0.3)!important; }

.soc-status.euiBadge {
  font-family:ui-monospace, 'Courier New', monospace !important;
  font-size:12px !important; border-radius:6px !important;
  padding:4px 10px !important; border:1px solid !important;
}
.soc-status--open.euiBadge         { background:rgba(248,113,113,0.10)!important; color:var(--critical)!important; border-color:rgba(248,113,113,0.25)!important; }
.soc-status--acknowledged.euiBadge { background:rgba(251,191,36,0.10)!important;  color:var(--medium)!important;   border-color:rgba(251,191,36,0.25)!important; }
.soc-status--closed.euiBadge       { background:rgba(52,211,153,0.10)!important;  color:var(--low)!important;      border-color:rgba(52,211,153,0.25)!important; }

.soc-table .euiTable { background:transparent !important; }
.soc-table .euiTableHeaderCell {
  font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
  font-size:12px !important; font-weight:700 !important;
  letter-spacing:1px !important; color:var(--text3) !important;
  border-bottom:1px solid var(--border) !important;
  text-transform:uppercase !important; background:transparent !important;
}
.soc-table .euiTableRow {
  border-bottom:1px solid var(--border2) !important;
  transition:background 0.15s;
}
.soc-table .euiTableRow:hover td { background:var(--surface2) !important; }
.soc-table .euiTableRowCell { border:none !important; }
.soc-table .euiTableRowCell * { font-size:14px !important; }

.soc-row--critical td:first-child { border-left:3px solid var(--critical) !important; }
.soc-row--high     td:first-child { border-left:3px solid var(--high)     !important; }
.soc-row--medium   td:first-child { border-left:3px solid var(--medium)   !important; }
.soc-row--low      td:first-child { border-left:3px solid var(--low)      !important; }

.soc-mono  { font-family:ui-monospace, 'Courier New', monospace; font-size:13px !important; }
.soc-muted { color:var(--text3); }

.soc-details.euiPanel {
  background:var(--surface2) !important;
  border:1px solid var(--border) !important;
  border-radius:12px !important;
  margin:14px 18px !important;
}
.soc-details .euiDescriptionList__title {
  font-family:ui-monospace, 'Courier New', monospace !important;
  font-size:11px !important; color:var(--text3) !important;
  text-transform:uppercase; letter-spacing:1px;
}
.soc-details .euiDescriptionList__description {
  font-family:ui-monospace, 'Courier New', monospace !important;
  font-size:13px !important; color:var(--text) !important;
}
.soc-details-title {
  font-size:13px; font-weight:700; text-transform:uppercase;
  letter-spacing:1.5px; color:var(--text3); margin-bottom:12px;
}
.soc-payload-lbl {
  font-size:11px; font-weight:700; text-transform:uppercase;
  letter-spacing:1px; color:var(--text3); margin:12px 0 6px;
}
.soc-details .euiCodeBlock {
  background:var(--bg) !important;
  border:1px solid var(--border2) !important;
  font-size:12px !important; border-radius:8px !important;
}
.soc-details .euiButton--fill {
  background:var(--accent) !important; border-color:var(--accent) !important;
  color:#fff !important;
  font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
  font-size:14px !important; font-weight:600 !important;
  border-radius:8px !important;
}

.soc-loading {
  display:flex; flex-direction:column;
  align-items:center; justify-content:center;
  gap:18px; min-height:360px;
}
.soc-loading-text {
  font-family:ui-monospace, 'Courier New', monospace;
  font-size:15px; color:var(--text3);
  animation: breathe 1.6s ease-in-out infinite;
}
@keyframes breathe { 0%,100%{opacity:0.4;} 50%{opacity:1;} }

.soc-root .euiPageTemplate__section { background:transparent !important; }
.soc-root .euiButton--small {
  font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
  font-size:14px !important; font-weight:600 !important;
  border-color:var(--border) !important; color:var(--text2) !important;
  background:var(--surface2) !important; border-radius:8px !important;
  transition:all 0.2s ease !important;
}
.soc-root .euiButton--small:hover {
  background:var(--accent) !important; color:#fff !important;
  border-color:var(--accent) !important;
}

::-webkit-scrollbar { width:5px; height:5px; }
::-webkit-scrollbar-track { background:var(--bg); }
::-webkit-scrollbar-thumb { background:var(--border); border-radius:3px; }
::-webkit-scrollbar-thumb:hover { background:var(--accent); }

/* Screenshot-like light dashboard shell */
.soc-shell {
  background: #f3f4f6;
  color: #111827;
  min-height: 100vh;
}

.soc-topnav {
  background: #425da3;
  height: 56px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.soc-logo-sm {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: #e8edf9;
  color: #425da3;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 12px;
}

.soc-tab-active {
  background: #ffffff;
  color: #111827;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 6px 10px;
  font-weight: 600;
}

.soc-breadcrumb-lite { color: #e5e7eb; font-weight: 600; }
.soc-flex-1 { flex: 1; }
.soc-top-actions { display: flex; align-items: center; gap: 10px; color: #fff; }
.soc-avatar { width: 34px; height: 34px; border-radius: 999px; background: #f3f4f6; color: #111827; display: flex; align-items: center; justify-content: center; font-weight: 700; }

.soc-toolbar {
  padding: 12px 16px;
  display: grid;
  grid-template-columns: 1fr auto auto auto auto;
  gap: 10px;
  align-items: center;
}

.soc-input-lite {
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 8px 12px;
  background: #fff;
}

.soc-btn-lite,
.soc-icon-lite {
  border: 1px solid #c7cfdf;
  border-radius: 4px;
  background: #fff;
  color: #334155;
  padding: 8px 10px;
}

.soc-btn-primary {
  background: #425da3;
  color: #fff;
  border: 1px solid #425da3;
  border-radius: 4px;
  padding: 8px 14px;
  font-weight: 600;
}

.soc-filter-row-lite {
  padding: 0 16px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #111827;
}

.soc-filter-links { display: flex; gap: 18px; color: #111827; font-weight: 600; }

.soc-page {
  padding: 0 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.soc-grid-2 {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 12px;
}

.soc-grid-2b {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 12px;
}

.soc-grid-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
}

.soc-card-lite {
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 8px 10px;
}

.soc-card-head-lite {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.soc-title-lite { font-size: 28px; font-weight: 700; }
.soc-mini-actions { display: flex; align-items: center; gap: 10px; color: #334155; }
.soc-link-btn { border: 1px solid #425da3; color: #425da3; background: #eef2ff; border-radius: 4px; padding: 2px 8px; }
.soc-icon-btn {
  border: 1px solid #c7cfdf;
  border-radius: 4px;
  background: #fff;
  color: #334155;
  width: 28px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.soc-sev-grid-lite {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.soc-alert-metric-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  overflow: hidden;
}

.soc-alert-metric-card {
  min-height: 88px;
  padding: 8px 10px;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  border-right: 1px solid #d1d5db;
}

.soc-alert-metric-card:last-child { border-right: none; }
.soc-alert-metric-title { font-size: 12px; font-weight: 600; color: #374151; }
.soc-alert-metric-subtitle { font-size: 11px; color: #6b7280; }
.soc-alert-metric-value { font-size: 24px; font-weight: 700; color: #111827; text-align: right; line-height: 1; }
.soc-alert-metric-card--critical { background: #f6e4e4; border-top: 2px solid #ef4444; }
.soc-alert-metric-card--high { background: #f6e8d8; border-top: 2px solid #f97316; }
.soc-alert-metric-card--medium { background: #f5efcb; border-top: 2px solid #eab308; }
.soc-alert-metric-card--low { background: #ddf4dd; border-top: 2px solid #22c55e; }

.soc-sev-cell {
  border-radius: 4px;
  border: 1px solid #e5e7eb;
  padding: 6px 10px;
}

.soc-sev-cell h4 { margin: 0 0 4px; font-size: 28px; text-align: center; }
.soc-sev-cell p { margin: 0; color: #374151; font-weight: 600; }
.soc-sev-critical { background: #f6e4e4; border-color: #ef4444; }
.soc-sev-high { background: #f6e8d8; border-color: #f97316; }
.soc-sev-medium { background: #f5efcb; border-color: #eab308; }
.soc-sev-low { background: #ddf4dd; border-color: #22c55e; }

.soc-table-lite {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.soc-table-lite th,
.soc-table-lite td {
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
  padding: 8px 6px;
  white-space: nowrap;
}

.soc-view-btn {
  border: 1px solid #425da3;
  background: #eef2ff;
  color: #425da3;
  border-radius: 4px;
  padding: 3px 10px;
  font-weight: 600;
  cursor: pointer;
}

.soc-table-lite tbody tr {
  cursor: pointer;
}

.soc-table-lite tbody tr:hover {
  background: #f8fafc;
}

.soc-alert-details {
  margin-top: 10px;
  border: 1px solid #dbe3f3;
  border-radius: 6px;
  background: #f8fbff;
  padding: 10px;
}

.soc-alert-details-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 14px;
  margin-top: 8px;
}

.soc-alert-details-item strong {
  display: block;
  color: #475569;
  font-size: 12px;
}

.soc-alert-details-item span {
  color: #0f172a;
  font-size: 13px;
}

.soc-domain-list { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; padding: 8px 4px; }
.soc-domain-list a { color: #111827; text-decoration: underline; }

@media (max-width: 1200px) {
  .soc-grid-2, .soc-grid-2b, .soc-grid-3 { grid-template-columns: 1fr; }
  .soc-toolbar { grid-template-columns: 1fr; }
}
`;

const makeC = (dark: boolean) => ({
  tt: {
    backgroundColor: dark ? 'rgba(6,14,31,0.97)' : 'rgba(255,255,255,0.97)',
    borderColor: dark ? 'rgba(59,130,246,0.3)' : 'rgba(37,99,235,0.2)',
    borderWidth: 1,
    titleColor: dark ? '#60a5fa' : '#2563eb',
    bodyColor:  dark ? '#7ca3d4' : '#3a5a90',
    padding: 12, cornerRadius: 8,
    titleFont: { family: "ui-monospace, 'Courier New', monospace", size: 12 },
    bodyFont:  { family: "ui-monospace, 'Courier New', monospace", size: 12 },
  },
  sx: {
    ticks:  { color: dark ? '#3d6490' : '#7aa0cc', font: { family: "'JetBrains Mono', monospace", size: 11 } },
    grid:   { color: dark ? 'rgba(59,130,246,0.05)' : 'rgba(37,99,235,0.05)' },
    border: { color: 'transparent' },
  },
  sy: {
    ticks:  { color: dark ? '#3d6490' : '#7aa0cc', font: { family: "'JetBrains Mono', monospace", size: 11 } },
    grid:   { color: dark ? 'rgba(59,130,246,0.05)' : 'rgba(37,99,235,0.05)' },
    border: { color: 'transparent' },
  },
  sev: {
    critical: dark ? '#f87171' : '#dc2626',
    high:     dark ? '#fb923c' : '#ea580c',
    medium:   dark ? '#fbbf24' : '#b45309',
    low:      dark ? '#34d399' : '#059669',
  },
  blue:   dark ? '#3b82f6' : '#2563eb',
  purple: dark ? '#a78bfa' : '#7c3aed',
});

const StackedChart: React.FC<{ data: Array<{ x: string; y: number }>; dark: boolean }> = ({ data, dark }) => {
  const C = makeC(dark);
  const vals = data.map((d) => d.y);
  const mk = (frac: number, color: string, label: string) => ({
    label,
    data: vals.map((v) => Math.round(v * frac)),
    borderColor: color,
    borderWidth: 1.5,
    backgroundColor: color + '18',
    fill: true,
    tension: 0.4,
    pointRadius: 0,
  });
  const chartData: ChartData<'line'> = {
    labels: data.map((d) => d.x),
    datasets: [mk(0.08, C.sev.critical, 'Critical'), mk(0.18, C.sev.high, 'High'), mk(0.34, C.sev.medium, 'Medium'), mk(0.40, C.sev.low, 'Low')],
  };
  const lc = dark ? '#3d6490' : '#7aa0cc';
  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 900 },
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        labels: { color: lc, font: { family: "ui-monospace, 'Courier New', monospace", size: 11 }, boxWidth: 10, padding: 14 },
      },
      tooltip: { ...C.tt, mode: 'index', intersect: false },
    },
    scales: { x: C.sx, y: C.sy },
  };
  return <Line data={chartData} options={options} />;
};

const DonutChart: React.FC<{ counts: Record<AlertSeverity, number>; dark: boolean }> = ({ counts, dark }) => {
  const C = makeC(dark);
  const chartData: ChartData<'doughnut'> = {
    labels: ['Critical', 'High', 'Medium', 'Low'],
    datasets: [{
      data: [counts.critical, counts.high, counts.medium, counts.low],
      backgroundColor: [C.sev.critical + '20', C.sev.high + '20', C.sev.medium + '18', C.sev.low + '18'],
      borderColor: [C.sev.critical, C.sev.high, C.sev.medium, C.sev.low],
      borderWidth: 2,
      hoverOffset: 8,
      hoverBackgroundColor: [C.sev.critical + '40', C.sev.high + '40', C.sev.medium + '35', C.sev.low + '35'],
    }],
  };
  const lc = dark ? '#3d6490' : '#7aa0cc';
  const options: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '70%',
    animation: { duration: 1000 },
    plugins: {
      legend: {
        display: true,
        position: 'bottom' as const,
        labels: { color: lc, font: { family: "ui-monospace, 'Courier New', monospace", size: 11 }, boxWidth: 11, padding: 12 },
      },
      tooltip: C.tt,
    },
  };
  return <Doughnut data={chartData} options={options} />;
};

const BarChart: React.FC<{ data: Array<{ label: string; count: number }>; dark: boolean }> = ({ data, dark }) => {
  const C = makeC(dark);
  const colors = [C.sev.critical, C.sev.high, C.sev.medium, C.sev.low];
  const chartData: ChartData<'bar'> = {
    labels: data.map((d) => d.label),
    datasets: [{
      label: 'Count',
      data: data.map((d) => d.count),
      backgroundColor: colors.map((c) => c + '22'),
      borderColor: colors,
      borderWidth: 2,
      borderRadius: 8,
      hoverBackgroundColor: colors.map((c) => c + '40'),
    }],
  };
  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y' as const,
    animation: { duration: 900 },
    plugins: { legend: { display: false }, tooltip: C.tt },
    scales: { x: C.sx, y: { ...C.sy, grid: { color: 'transparent' } } },
  };
  return <Bar data={chartData} options={options} />;
};

export const TlsocPluginApp = ({ basename, notifications, http, navigation }: TlsocPluginAppDeps) => {
  const [dark,             setDark]             = useState<boolean>(false);
  const [dashboard,        setDashboard]        = useState<DashboardMetrics | null>(null);
  const [windowFrom,       setWindowFrom]       = useState<WindowValue>(DEFAULT_WINDOW_FROM);
  const [isLoading,        setIsLoading]        = useState<boolean>(true);
  const [isRefreshing,     setIsRefreshing]     = useState<boolean>(false);
  const [error,            setError]            = useState<string>('');
  const [selectedAlert,    setSelectedAlert]    = useState<RecentAlertRow | null>(null);

  useEffect(() => {
    const id = 'soc-v2-styles';
    if (!document.getElementById(id)) {
      const s = document.createElement('style');
      s.id = id; s.textContent = DASHBOARD_CSS;
      document.head.appendChild(s);
    }
  }, []);

  const loadDashboard = useCallback(async (silent = false) => {
    silent ? setIsRefreshing(true) : setIsLoading(true);
    setError('');
    try {
      const res = await http.get('/api/tlsoc_plugin/dashboard/metrics', { query: { from_date: windowFrom, to_date: 'now' } });
      setDashboard(res as DashboardMetrics);
    } catch (err) {
      const msg = err instanceof Error ? err.message
        : i18n.translate('tlsocPlugin.dashboardUnknownError', { defaultMessage: 'Unknown error' });
      setError(msg);
      notifications.toasts.addDanger({
        title: i18n.translate('tlsocPlugin.dashboardLoadFailed', { defaultMessage: 'Failed to load dashboard' }),
        text: msg,
      });
    } finally { setIsLoading(false); setIsRefreshing(false); }
  }, [http, notifications.toasts, windowFrom]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);
  useEffect(() => {
    const t = window.setInterval(() => loadDashboard(true), LIVE_REFRESH_MS);
    return () => window.clearInterval(t);
  }, [loadDashboard]);

  const severityCounts = useMemo(() => {
    const init: Record<AlertSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    return (dashboard?.bySeverity ?? []).reduce(
      (acc, item) => { acc[item.severity] = item.count; return acc; }, { ...init }
    );
  }, [dashboard]);

  const trendBase = useMemo(
    () => (dashboard?.alertsOverTime ?? []).map((p, i) => ({ x: p.timestamp || `t-${i}`, y: Number.isFinite(p.count) ? p.count : 0 })),
    [dashboard]
  );

  const resolveMitreName = useCallback((row: SecurityAlert): string => {
    const tacticFromRule = (row as any)?.mitreTacticName;
    const tactic = row.mitreTactics?.map((t) => t?.name).find((n) => Boolean(n && n.trim()));
    const technique = row.mitreTechniques?.map((t) => t?.name).find((n) => Boolean(n && n.trim()));
    const mitreFromRow = [
      tacticFromRule,
      (row as any)?.mitre,
      (row as any)?.mitreTechnique,
      (row as any)?.mitreTactic,
    ].find((n) => typeof n === 'string' && n.trim());

    return (tactic || technique || mitreFromRow || 'N/A') as string;
  }, []);

  const extractEventLocationFields = useCallback((eventText?: string) => {
    if (!eventText || typeof eventText !== 'string') {
      return {} as { destinationIp?: string; server?: string };
    }

    try {
      const parsed = JSON.parse(eventText) as any;
      const destinationIp = parsed?.transaction?.host_ip || parsed?.destination?.ip || parsed?.destination?.address;
      const server = parsed?.transaction?.server_id || parsed?.observer?.server || parsed?.host?.name;
      return {
        destinationIp: typeof destinationIp === 'string' ? destinationIp : undefined,
        server: typeof server === 'string' ? server : undefined,
      };
    } catch {
      return {} as { destinationIp?: string; server?: string };
    }
  }, []);

  const recentAlertRows = useMemo<RecentAlertRow[]>(
    () => (dashboard?.recentHighRisk ?? []).slice(0, 20).map((row: SecurityAlert, i) => ({
      id: `a${i}`, alertUuid: row.alertUuid || `missing-${i}`,
      timestamp: row.timestamp, severity: row.severity,
      ruleName: row.ruleName, userName: row.userName || '-',
      server: row.observerServer || '-', status: row.workflowStatus,
      sourceIp: row.sourceIp || '-', destinationIp: row.destinationIp || '-',
      eventPayload: row.eventPayload || '-',
      mitre: resolveMitreName(row),
      eventId: row.eventId || row.alertUuid || '-',
      eventOriginal: row.eventOriginal || row.eventPayload || '-',
      signalStatus: row.signalStatus || row.workflowStatus || '-',
      mitreTacticName: (row as any).mitreTacticName || 'N/A',
    })), [dashboard, resolveMitreName]
  );

  const openAlertDetails = useCallback(async (row: RecentAlertRow) => {
    setSelectedAlert(row);
    if (!row.alertUuid || row.alertUuid.startsWith('missing-')) return;
    try {
      const details = await http.get('/api/tlsoc_plugin/dashboard/alert_details', {
        query: { alert_uuid: row.alertUuid, rule_name: row.ruleName, timestamp: row.timestamp },
      }) as AlertDetailsResponse;
        const parsedEventFields = extractEventLocationFields(details.eventOriginal || details.eventPayload);
      setSelectedAlert((prev) => {
        if (!prev || prev.alertUuid !== row.alertUuid) return prev;
        return {
          ...prev,
          sourceIp:      details.sourceIp      || prev.sourceIp,
          destinationIp: details.destinationIp || parsedEventFields.destinationIp || prev.destinationIp,
          server:        details.server        || parsedEventFields.server || prev.server,
          eventPayload:  details.eventPayload  || prev.eventPayload,
          mitre:         details.mitreTacticName || details.mitre || prev.mitre,
          mitreTacticName: details.mitreTacticName || prev.mitreTacticName,
          eventId:       details.eventId       || prev.eventId,
          eventOriginal: details.eventOriginal || prev.eventOriginal,
          signalStatus:  details.signalStatus  || prev.signalStatus,
        };
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load alert details';
      notifications.toasts.addWarning({ title: 'Showing cached row details', text: message });
    }
  }, [http, notifications.toasts]);

  const mitreTactics = useMemo<MitreTacticRow[]>(() => {
    const map: Record<string, MitreTacticRow> = {};
    (dashboard?.recentHighRisk ?? []).forEach((row: SecurityAlert, i) => {
      const tactic = resolveMitreName(row);
      const technique = row.mitreTechniques?.[0]?.name || row.mitreTactics?.[0]?.name || row.ruleName || 'N/A';
      const key       = `${tactic}::${technique}`;
      if (map[key]) map[key].count += 1;
      else          map[key] = { id: `m${i}`, tactic, technique, count: 1, severity: row.severity };
    });
    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [dashboard, resolveMitreName]);

  const totalAlerts = severityCounts.critical + severityCounts.high + severityCounts.medium + severityCounts.low;
  const totalCount = dashboard?.total ?? 0;

  const fmtTime = (v: string) => {
    const d = new Date(v);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  const alertColumns: Array<EuiBasicTableColumn<RecentAlertRow>> = [
    {
      field: 'timestamp', name: 'Time', width: '68px',
      render: (v: string) => <span className="soc-mono soc-muted">{fmtTime(v)}</span>,
    },
    {
      field: 'severity', name: 'Sev', width: '92px',
      render: (v: AlertSeverity) => <EuiBadge className={`soc-sev soc-sev--${v}`}>{v.toUpperCase()}</EuiBadge>,
    },
    {
      field: 'ruleName', name: 'Rule', truncateText: true,
      render: (v: string) => <span style={{ fontSize: 14, fontWeight: 500 }}>{v}</span>,
    },
    {
      field: 'userName', name: 'User', width: '112px',
      render: (v: string) => <span className="soc-mono">{v}</span>,
    },
    {
      field: 'server', name: 'Server', width: '120px',
      render: (v: string) => <span className="soc-mono">{v}</span>,
    },
    {
      field: 'status', name: 'Status', width: '122px',
      render: (v: string) => <EuiBadge className={`soc-status soc-status--${v}`}>{v}</EuiBadge>,
    },
    {
      name: '', width: '70px',
      render: (row: RecentAlertRow) => (
        <EuiButton size="s" onClick={(e: React.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); openAlertDetails(row); }}>
          View
        </EuiButton>
      ),
    },
  ];

  const mitreColumns: Array<EuiBasicTableColumn<MitreTacticRow>> = [
    { field: 'tactic',    name: 'Tactic',    render: (v: string) => <span style={{ fontSize: 14 }}>{v}</span> },
    { field: 'technique', name: 'Technique', truncateText: true, render: (v: string) => <span className="soc-mono">{v}</span> },
    {
      field: 'severity', name: 'Sev', width: '68px',
      render: (v: AlertSeverity) => <EuiBadge className={`soc-sev soc-sev--${v}`}>{v[0].toUpperCase()}</EuiBadge>,
    },
    { field: 'count', name: '#', width: '50px', render: (v: number) => <strong className="soc-mono">{v}</strong> },
  ];

  const visibleRows = recentAlertRows.slice(0, 6);
  const mitreBarData = mitreTactics.slice(0, 5).map((m) => ({ label: m.tactic, count: m.count }));

  const csvEscape = useCallback((value: unknown): string => {
    const str = String(value ?? '');
    return `"${str.replace(/"/g, '""')}"`;
  }, []);

  const triggerCsvDownload = useCallback((filename: string, headers: string[], rows: Array<Array<unknown>>) => {
    const csv = [
      headers.map(csvEscape).join(','),
      ...rows.map((r) => r.map(csvEscape).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [csvEscape]);

  const downloadDashboardCsv = useCallback(() => {
    const nowIso = new Date().toISOString();
    const rows: Array<Array<unknown>> = [];

    rows.push(['SUMMARY', 'Generated At', nowIso]);
    rows.push(['SUMMARY', 'Total Alerts', totalCount]);
    rows.push(['SUMMARY', 'Critical', severityCounts.critical]);
    rows.push(['SUMMARY', 'High', severityCounts.high]);
    rows.push(['SUMMARY', 'Medium', severityCounts.medium]);
    rows.push(['SUMMARY', 'Low', severityCounts.low]);

    trendBase.forEach((t) => rows.push(['ALERTS_OVER_TIME', t.x, t.y]));
    mitreTactics.forEach((m) => rows.push(['MITRE', m.tactic, m.technique, m.count, m.severity]));
    recentAlertRows.forEach((r) => rows.push([
      'RECENT_ALERT',
      r.timestamp,
      r.ruleName,
      r.server,
      r.sourceIp,
      r.destinationIp,
      r.eventId,
      r.mitre,
      r.signalStatus,
      r.eventOriginal,
    ]));

    triggerCsvDownload(
      `tlsoc_dashboard_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`,
      ['section', 'col1', 'col2', 'col3', 'col4', 'col5', 'col6', 'col7', 'col8', 'col9'],
      rows
    );
  }, [mitreTactics, recentAlertRows, severityCounts.critical, severityCounts.high, severityCounts.low, severityCounts.medium, totalCount, trendBase, triggerCsvDownload]);

  const buildDiscoverLogsUrl = useCallback((eventId: string) => {
    const discoverBase = 'https://10.130.171.246:5601/s/tlsoc/app/discover';
    const cleanEventId = (eventId || '').trim();

    if (!cleanEventId || cleanEventId === '-') {
      return discoverBase;
    }

    const escapedId = cleanEventId.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'");
    const kuery = `event.id : "${escapedId}" or kibana.alert.original_event.id : "${escapedId}"`;
    const appState = `(query:(language:kuery,query:'${kuery}'))`;

    return `${discoverBase}#/?_a=${encodeURIComponent(appState)}`;
  }, []);

  return (
    <Router basename={basename}>
      <I18nProvider>
        <>
          <navigation.ui.TopNavMenu appName={PLUGIN_ID} showSearchBar useDefaultBehaviors />

          <div className="soc-shell">
            <div className="soc-topnav">
              <div className="soc-logo-sm">TL</div>
              <EuiIcon type="menu" color="ghost" />
              <button className="soc-tab-active">Explore</button>
              {/* <div className="soc-breadcrumb-lite">&gt; Dashboard</div> */}
              <div className="soc-flex-1" />
              <div className="soc-top-actions">
                <button className="soc-icon-lite" onClick={() => setDark((d) => !d)}>{dark ? '☀' : '◐'}</button>
                <div className="soc-avatar">A</div>
                <EuiIcon type="questionInCircle" color="ghost" />
              </div>
            </div>

            <div className="soc-toolbar">
              <input className="soc-input-lite" placeholder="Search" />
              <button className="soc-icon-lite" title="bookmark">🔖</button>
              <EuiSelect
                options={WINDOW_OPTIONS}
                value={windowFrom}
                onChange={(e) => setWindowFrom(e.target.value as WindowValue)}
                aria-label="Time window"
              />
              <div>A day ago &nbsp; ⟶ &nbsp; Now</div>
              <button className="soc-btn-primary" onClick={() => loadDashboard(true)} disabled={isRefreshing}>
                {isRefreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            {/* <div className="soc-filter-row-lite">
              <div><strong>➕ Add filter</strong></div>
              <div className="soc-filter-links">
                <span>Full screen</span>
                <button className="soc-link-btn" onClick={downloadDashboardCsv}>Download data</button>
                <span>Share</span><span>Clone</span><span>Reporting</span><span>Edit</span>
              </div>
            </div> */}

            <div className="soc-page">
              {isLoading && !dashboard && (
                <div className="soc-card-lite">
                  <EuiLoadingSpinner size="xl" /> Loading threat data...
                </div>
              )}

              {!isLoading && error && (
                <EuiCallOut title="Unable to load dashboard" color="danger" iconType="alert">
                  <p>{error}</p>
                </EuiCallOut>
              )}

              {dashboard && (
                <>
                  <div className="soc-grid-2">
                    <div className="soc-card-lite">
                      <div className="soc-card-head-lite">
                        <strong>Alerts</strong>
                        <div className="soc-mini-actions">
                          <button className="soc-link-btn" onClick={downloadDashboardCsv}>Download data</button>
                        </div>
                      </div>
                      <div className="soc-sev-grid-lite">
                        <div className="soc-sev-cell soc-sev-critical"><p>Count</p><h4>{totalCount}</h4></div>
                        <div className="soc-sev-cell soc-sev-high"><p>High Severity</p><h4>{severityCounts.high}</h4></div>
                        <div className="soc-sev-cell soc-sev-medium"><p>Medium severity</p><h4>{severityCounts.medium}</h4></div>
                        <div className="soc-sev-cell soc-sev-low"><p>Low Severity</p><h4>{severityCounts.low}</h4></div>
                      </div>
                    </div>

                    <div className="soc-card-lite">
                      <div className="soc-card-head-lite">
                        <strong>Events per seconds</strong>
                        <div className="soc-mini-actions">
                          <button className="soc-icon-btn"><EuiIcon type="sortRight" /></button>
                          <button className="soc-link-btn" onClick={downloadDashboardCsv}>Download data</button>
                        </div>
                      </div>
                      <div style={{ height: 210 }}>
                        {trendBase.length > 0
                          ? <StackedChart data={trendBase} dark={dark} />
                          : <EuiEmptyPrompt iconType="visualizeApp" title={<h3>No traffic data</h3>} color="subdued" />}
                      </div>
                    </div>
                  </div>

                  <div className="soc-grid-2b">
                    <div className="soc-card-lite">
                      <div className="soc-card-head-lite">
                        <strong>Alerts Table</strong>
                        <div className="soc-mini-actions">
                          <button className="soc-icon-btn"><EuiIcon type="importAction" /></button>
                          <button className="soc-link-btn" onClick={downloadDashboardCsv}>Download data</button>
                        </div>
                      </div>
                      <table className="soc-table-lite">
                        <thead>
                          <tr><th>@TIMESTAMP</th><th>ALERT NAME</th><th>SEVERITY</th><th>ACTION</th></tr>
                        </thead>
                        <tbody>
                          {visibleRows.map((r) => (
                            <tr key={r.id}>
                              <td>{r.timestamp}</td>
                              <td>{r.ruleName}</td>
                              <td>
                                <EuiBadge className={`soc-sev soc-sev--${r.severity}`}>{r.severity.toUpperCase()}</EuiBadge>
                              </td>
                              <td>
                                <button className="soc-view-btn" onClick={() => openAlertDetails(r)}>View</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      <div className="soc-alert-details">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <strong>Alert Details</strong>
                          {selectedAlert && (
                            <button className="soc-view-btn" onClick={() => setSelectedAlert(null)}>Close</button>
                          )}
                        </div>
                        {selectedAlert ? (
                          <>
                            <div className="soc-alert-details-grid">
                              <div className="soc-alert-details-item"><strong>Source IP</strong><span>{selectedAlert.sourceIp}</span></div>
                              <div className="soc-alert-details-item"><strong>Destination IP</strong><span>{selectedAlert.destinationIp}</span></div>
                              <div className="soc-alert-details-item"><strong>Event ID</strong><span>{selectedAlert.eventId}</span></div>
                              <div className="soc-alert-details-item"><strong>Name of Attack</strong><span>{selectedAlert.ruleName}</span></div>
                              <div className="soc-alert-details-item"><strong>Attack Came From Server</strong><span>{selectedAlert.server}</span></div>
                              <div className="soc-alert-details-item"><strong>MITRE</strong><span>{selectedAlert.mitre}</span></div>
                              <div className="soc-alert-details-item"><strong>kibana.alert.rule.threat.tactic.name</strong><span>{selectedAlert.mitreTacticName}</span></div>
                              <div className="soc-alert-details-item"><strong>Signal Status</strong><span>{selectedAlert.signalStatus}</span></div>
                              <div className="soc-alert-details-item"><strong>Event Original</strong><span>{selectedAlert.eventOriginal}</span></div>
                            </div>
                            <div style={{ marginTop: 10 }}>
                              <EuiButton
                                size="s"
                                fill
                                href={buildDiscoverLogsUrl(selectedAlert.eventId)}
                                target="_self"
                                iconType="link"
                              >
                                View Logs
                              </EuiButton>
                            </div>
                          </>
                        ) : (
                          <div style={{ marginTop: 8, color: '#64748b' }}>Click View on any row to see details.</div>
                        )}
                      </div>
                    </div>

                    <div className="soc-card-lite">
                      <div className="soc-card-head-lite">
                        <strong>Log sources location and count</strong>
                        <div className="soc-mini-actions">
                          <button className="soc-icon-btn"><EuiIcon type="importAction" /></button>
                          <button className="soc-link-btn" onClick={downloadDashboardCsv}>Download data</button>
                        </div>
                      </div>
                      <div style={{ height: 210 }}>
                        {totalAlerts > 0 ? <DonutChart counts={severityCounts} dark={dark} /> : <EuiEmptyPrompt iconType="visPie" title={<h3>No data</h3>} color="subdued" />}
                      </div>
                    </div>
                  </div>

                  <div className="soc-grid-3">
                    <div className="soc-card-lite">
                      <div className="soc-card-head-lite">
                        <strong>Top 5</strong>
                        <div className="soc-mini-actions">
                          <button className="soc-icon-btn"><EuiIcon type="importAction" /></button>
                          <button className="soc-link-btn" onClick={downloadDashboardCsv}>Download data</button>
                        </div>
                      </div>
                      <div style={{ height: 170 }}>
                        {totalAlerts > 0 ? <DonutChart counts={severityCounts} dark={dark} /> : <EuiEmptyPrompt iconType="visPie" title={<h3>No data</h3>} color="subdued" />}
                      </div>
                    </div>

                    <div className="soc-card-lite">
                      <div className="soc-card-head-lite">
                        <strong>Mitre</strong>
                        <div className="soc-mini-actions">
                          <button className="soc-icon-btn"><EuiIcon type="importAction" /></button>
                          <button className="soc-link-btn" onClick={downloadDashboardCsv}>Download data</button>
                        </div>
                      </div>
                      <div style={{ height: 170 }}>
                        {mitreBarData.length > 0
                          ? <BarChart data={mitreBarData} dark={dark} />
                          : <EuiEmptyPrompt iconType="visBarVertical" title={<h3>No data</h3>} color="subdued" />}
                      </div>
                    </div>

                    <div className="soc-card-lite">
                      <div className="soc-card-head-lite">
                        <strong>Domain specific dashboards</strong>
                      </div>
                      <div className="soc-domain-list">
                        <a href="#">Email specific</a>
                        <a href="#">Hosts Level</a>
                        <a href="#">Threat intelligence</a>
                        <a href="#">Endpoints</a>
                      </div>
                      {selectedAlert && (
                        <div style={{ marginTop: 10, fontSize: 12, color: '#475569' }}>
                          Selected: {selectedAlert.ruleName}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'none' }}>
                    <EuiBasicTable items={recentAlertRows} columns={alertColumns} />
                    <EuiBasicTable items={mitreTactics} columns={mitreColumns} />
                    <EuiCodeBlock language="json">{selectedAlert?.eventPayload || '-'}</EuiCodeBlock>
                    <EuiDescriptionList listItems={[{ title: 'Event ID', description: selectedAlert?.eventId || '-' }]} />
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      </I18nProvider>
    </Router>
  );
};
