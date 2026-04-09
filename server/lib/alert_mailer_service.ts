import fs from 'fs';
import path from 'path';
import nodemailer, { type Transporter } from 'nodemailer';
import type { ElasticsearchClient, Logger } from '../../../../src/core/server';

const ALERT_INDICES = ['tlsoc-alerts-*', '.alerts-security*'];
const DEFAULT_ADMIN_EMAIL = 'darshanmutalikdesai46@gmail.com';
const DUPLICATE_WINDOW_MS = 60 * 1000;

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from: string;
}

export interface MailerStatus {
  active: boolean;
  pollIntervalSeconds: number;
  adminEmail: string;
  smtpConfigured: boolean;
  lastError: string | null;
  lastProcessedAt: string | null;
}

interface AlertHit {
  _id?: string;
  _source?: Record<string, unknown>;
}

export class AlertMailerService {
  private readonly logger: Logger;
  private readonly configFilePath = path.join(process.cwd(), 'data', 'tlsocPlugin', 'mailer-config.json');
  private readonly processedAlertIds = new Set<string>();
  private transporter: Transporter | null = null;
  private smtpConfig: SmtpConfig | null = null;
  private adminEmail = DEFAULT_ADMIN_EMAIL;
  private pollIntervalSeconds = 30;
  private intervalHandle: NodeJS.Timeout | null = null;
  private esClient: ElasticsearchClient | null = null;
  private active = false;
  private lastError: string | null = null;
  private lastProcessedAt: string | null = null;
  private readonly lookbackMinutes = 10;
  private readonly recentAttackerNotifications = new Map<string, number>();
  private watchdogHandle: NodeJS.Timeout | null = null;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  public start(esClient: ElasticsearchClient) {
    this.esClient = esClient;
    this.loadPersistedConfig();
  }

  public stop() {
    this.active = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.watchdogHandle) {
      clearInterval(this.watchdogHandle);
      this.watchdogHandle = null;
    }
  }

  public configure(options: {
    smtp: SmtpConfig;
    adminEmail?: string;
    pollIntervalSeconds?: number;
  }) {
    this.smtpConfig = options.smtp;
    this.transporter = nodemailer.createTransport({
      host: options.smtp.host,
      port: options.smtp.port,
      secure: options.smtp.secure,
      auth: {
        user: options.smtp.username,
        pass: options.smtp.password,
      },
    });

    if (options.adminEmail) {
      this.adminEmail = options.adminEmail;
    }

    if (options.pollIntervalSeconds && options.pollIntervalSeconds > 4) {
      this.pollIntervalSeconds = options.pollIntervalSeconds;
    }

    this.persistConfig();
    this.logger.info(`[tlsocPlugin.mailer] Configured SMTP for ${this.adminEmail}`);
  }

  public async activate() {
    if (!this.esClient) {
      throw new Error('Mailer service is not started yet');
    }

    if (!this.transporter || !this.smtpConfig) {
      throw new Error('SMTP is not configured');
    }

    await this.transporter.verify();
    this.active = true;
    this.lastError = null;

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }

    this.intervalHandle = setInterval(() => {
      void this.pollAndSend();
    }, this.pollIntervalSeconds * 1000);

    if (this.watchdogHandle) {
      clearInterval(this.watchdogHandle);
    }
    this.watchdogHandle = setInterval(() => {
      if (this.active && !this.intervalHandle) {
        this.logger.warn('[tlsocPlugin.mailer] Poll interval lost. Restarting...');
        this.intervalHandle = setInterval(() => {
          void this.pollAndSend();
        }, this.pollIntervalSeconds * 1000);
      }
    }, 5000);

    await this.pollAndSend();
    this.logger.info('[tlsocPlugin.mailer] Mailer activated and polling every ' + this.pollIntervalSeconds + ' seconds');
  }

  public deactivate() {
    this.active = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.watchdogHandle) {
      clearInterval(this.watchdogHandle);
      this.watchdogHandle = null;
    }
    this.logger.info('[tlsocPlugin.mailer] Mailer deactivated');
  }

  public getStatus(): MailerStatus {
    return {
      active: this.active,
      pollIntervalSeconds: this.pollIntervalSeconds,
      adminEmail: this.adminEmail,
      smtpConfigured: Boolean(this.smtpConfig && this.transporter),
      lastError: this.lastError,
      lastProcessedAt: this.lastProcessedAt,
    };
  }

  private async pollAndSend() {
    if (!this.active || !this.esClient || !this.transporter || !this.smtpConfig) {
      return;
    }

    try {
      const result = await this.esClient.search({
        index: ALERT_INDICES,
        size: 50,
        sort: [{ '@timestamp': { order: 'desc' } }],
        _source: [
          '@timestamp',
          'kibana.alert.uuid',
          'kibana.alert.id',
          'kibana.alert.rule.name',
          'kibana.alert.reason',
          'kibana.alert.severity',
          'kibana.alert.rule.category',
          'rule.name',
          'tlsoc.alert.reason',
          'tlsoc.alert.severity',
          'observer.server',
          'service.name',
          'source.ip',
          'source.address',
          'client.ip',
          'user.name',
          'event.id',
          'event.action',
          'event.original',
          'event.payload',
          'message',
        ],
        query: {
          bool: {
            filter: [
              { range: { '@timestamp': { gte: `now-${this.lookbackMinutes}m`, lte: 'now' } } },
            ],
          },
        },
      });

      const body = (result as { body?: unknown }).body ?? result;
      const hits = ((((body as { hits?: { hits?: AlertHit[] } }).hits ?? {}).hits ?? []) as AlertHit[]);

      for (const hit of hits.reverse()) {
        const source = hit._source ?? {};
        const alertId = this.getString(source, 'kibana.alert.uuid') || this.getString(source, 'kibana.alert.id') || hit._id || '';
        if (!alertId || this.processedAlertIds.has(alertId)) {
          continue;
        }

        if (!this.isCriticalAttack(source)) {
          continue;
        }

        const attackerIdentity = this.getAttackerIdentity(source);
        if (!this.shouldSendForAttacker(attackerIdentity)) {
          continue;
        }

        this.processedAlertIds.add(alertId);
        if (this.processedAlertIds.size > 5000) {
          const first = this.processedAlertIds.values().next().value;
          if (first) {
            this.processedAlertIds.delete(first);
          }
        }

        await this.sendAlertMail(source, alertId);
      }

      this.lastProcessedAt = new Date().toISOString();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.error(`[tlsocPlugin.mailer] Poll/send failed: ${this.lastError}`);
    }
  }

  private async sendAlertMail(source: Record<string, unknown>, alertId: string) {
    if (!this.transporter || !this.smtpConfig) {
      return;
    }

    const ruleName = this.getString(source, 'kibana.alert.rule.name') || this.getString(source, 'rule.name') || 'Unknown attack';
    const reason =
      this.getString(source, 'kibana.alert.reason') ||
      this.getString(source, 'tlsoc.alert.reason') ||
      this.getString(source, 'event.action') ||
      this.getString(source, 'message') ||
      this.getString(source, 'event.original') ||
      'No reason available';
    const severity = this.getSeverity(source) || 'unknown';
    const category = this.getString(source, 'kibana.alert.rule.category') || 'unknown';
    const timestamp = this.getString(source, '@timestamp') || new Date().toISOString();
    const server = this.getString(source, 'observer.server') || this.getString(source, 'service.name') || 'website';
    const target = server.toLowerCase().includes('mail') ? 'mailing server' : 'website';
    const eventId = this.getString(source, 'event.id') || 'N/A';

    const subject = `[TLSOC ALERT] ${ruleName}`;
    const text = [
      `A new security alert has been generated.`,
      ``,
      `Attack/Rule: ${ruleName}`,
      `Severity: ${severity}`,
      `Category: ${category}`,
      `Reason: ${reason}`,
      `Target: ${target} (${server})`,
      `Alert ID: ${alertId}`,
      `Event ID: ${eventId}`,
      `Timestamp: ${timestamp}`,
    ].join('\n');

    await this.transporter.sendMail({
      from: this.smtpConfig.from,
      to: this.adminEmail,
      subject,
      text,
    });
  }

  private getString(source: Record<string, unknown>, dottedPath: string): string {
    if (Object.prototype.hasOwnProperty.call(source, dottedPath)) {
      const directValue = source[dottedPath];
      return typeof directValue === 'string' ? directValue : '';
    }

    const parts = dottedPath.split('.');
    let current: unknown = source;
    for (const part of parts) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return '';
      }
      current = (current as Record<string, unknown>)[part];
    }

    return typeof current === 'string' ? current : '';
  }

  private getSeverity(source: Record<string, unknown>): string {
    return (
      this.getString(source, 'kibana.alert.severity') ||
      this.getString(source, 'tlsoc.alert.severity') ||
      this.getString(source, 'event.severity')
    ).toLowerCase();
  }

  private isCriticalAttack(source: Record<string, unknown>): boolean {
    return this.getSeverity(source) === 'critical';
  }

  private getAttackerIdentity(source: Record<string, unknown>): string {
    return (
      this.getString(source, 'source.ip') ||
      this.getString(source, 'source.address') ||
      this.getString(source, 'client.ip') ||
      this.getString(source, 'user.name') ||
      'unknown-attacker'
    );
  }

  private shouldSendForAttacker(attackerIdentity: string): boolean {
    const now = Date.now();
    const lastSentAt = this.recentAttackerNotifications.get(attackerIdentity);

    for (const [identity, timestamp] of this.recentAttackerNotifications.entries()) {
      if (now - timestamp > DUPLICATE_WINDOW_MS) {
        this.recentAttackerNotifications.delete(identity);
      }
    }

    if (lastSentAt && now - lastSentAt < DUPLICATE_WINDOW_MS) {
      return false;
    }

    this.recentAttackerNotifications.set(attackerIdentity, now);
    return true;
  }

  private loadPersistedConfig() {
    try {
      if (!fs.existsSync(this.configFilePath)) {
        return;
      }

      const raw = fs.readFileSync(this.configFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as {
        smtp?: SmtpConfig;
        adminEmail?: string;
        pollIntervalSeconds?: number;
      };

      if (!parsed.smtp) {
        return;
      }

      this.smtpConfig = parsed.smtp;
      this.transporter = nodemailer.createTransport({
        host: parsed.smtp.host,
        port: parsed.smtp.port,
        secure: parsed.smtp.secure,
        auth: {
          user: parsed.smtp.username,
          pass: parsed.smtp.password,
        },
      });

      if (parsed.adminEmail) {
        this.adminEmail = parsed.adminEmail;
      }

      if (parsed.pollIntervalSeconds && parsed.pollIntervalSeconds > 4) {
        this.pollIntervalSeconds = parsed.pollIntervalSeconds;
      }

      this.logger.info(`[tlsocPlugin.mailer] Loaded persisted SMTP config from ${this.configFilePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[tlsocPlugin.mailer] Could not load persisted SMTP config: ${message}`);
    }
  }

  private persistConfig() {
    if (!this.smtpConfig) {
      return;
    }

    try {
      const dir = path.dirname(this.configFilePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.configFilePath,
        JSON.stringify(
          {
            smtp: this.smtpConfig,
            adminEmail: this.adminEmail,
            pollIntervalSeconds: this.pollIntervalSeconds,
          },
          null,
          2
        ),
        'utf-8'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[tlsocPlugin.mailer] Could not persist SMTP config: ${message}`);
    }
  }
}
