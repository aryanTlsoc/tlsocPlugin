// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface TlsocPluginPluginSetup {}
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface TlsocPluginPluginStart {}

export interface AlertData {
  _index: string;
  _id: string;
  _score: number;
  _source: {
    'kibana.alert.start': string;
    'kibana.alert.last_detected': string;
    'kibana.version': string;
    'kibana.alert.rule.parameters': {
      description: string;
      risk_score: number;
      severity: string;
      note?: string;
      threat?: any[];
      query?: string;
      filters?: any[];
    };
    'kibana.alert.rule.name': string;
    'kibana.alert.rule.category': string;
    'kibana.alert.status': string;
    'kibana.alert.severity': string;
    'kibana.alert.risk_score': number;
    'kibana.alert.reason': string;
    '@timestamp': string;
    'event.module'?: string;
    'event.action'?: string;
    'user.name'?: string;
    'user.target.name'?: string;
    'observer'?: {
      dept?: string;
      env?: string;
      source_host?: string;
      source_program?: string;
      server?: string;
      org?: string;
    };
    'process'?: {
      command_line?: string;
    };
  };
}

export interface AlertsResponse {
  took: number;
  timed_out: boolean;
  _shards: {
    total: number;
    successful: number;
    skipped: number;
    failed: number;
  };
  hits: {
    total: {
      value: number;
      relation: string;
    };
    max_score: number;
    hits: AlertData[];
  };
}

export interface AlertQueryParams {
  size?: number;
  from?: number;
  severity?: string;
  status?: string;
  rule_name?: string;
  user_name?: string;
  time_range?: {
    from: string;
    to: string;
  };
}
