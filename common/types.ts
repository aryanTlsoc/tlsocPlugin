/**
 * Types used for TLSOC security alert analytics.
 */

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';

export type AlertWorkflowStatus = 'open' | 'acknowledged' | 'closed';

export type AlertStatus = 'active' | 'recovered';

export interface MitreTactic {
  id: string;
  name: string;
  reference: string;
}

export interface MitreTechnique {
  id: string;
  name: string;
  reference: string;
  subtechnique: MitreTechnique[];
}

export interface SecurityAlert {
  timestamp: string;
  severity: AlertSeverity;
  riskScore: number;
  status: AlertStatus;
  workflowStatus: AlertWorkflowStatus;
  ruleName: string;
  ruleId: string;
  userName: string;
  targetUserName?: string;
  observerServer?: string;
  observerDept?: string;
  serviceName?: string;
  mitreTactics: MitreTactic[];
  mitreTechniques: MitreTechnique[];
  originalEventAction?: string;
  alertUuid: string;
}

export type AlertsOverTime = Array<{ timestamp: string; count: number }>;

export type AlertsBySeverity = Array<{ severity: AlertSeverity; count: number }>;

export type AlertsByRule = Array<{ ruleName: string; count: number }>;

export type AlertsByUser = Array<{ userName: string; count: number }>;

export type AlertsByMitre = Array<{ tacticName: string; count: number }>;

export interface DashboardMetrics {
  total: number;
  openCount: number;
  highCriticalCount: number;
  alertsOverTime: AlertsOverTime;
  bySeverity: AlertsBySeverity;
  byRule: AlertsByRule;
  byUser: AlertsByUser;
  byMitre: AlertsByMitre;
  recentHighRisk: SecurityAlert[];
}
