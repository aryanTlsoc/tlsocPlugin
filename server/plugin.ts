import {
  PluginInitializerContext,
  CoreSetup,
  CoreStart,
  Plugin,
  Logger,
} from '../../../src/core/server';

import type { TlsocPluginConfig } from './config';
import { TlsocPluginPluginSetup, TlsocPluginPluginStart } from './types';
import { defineRoutes } from './routes';
import { AlertMailerService } from './lib/alert_mailer_service';

export class TlsocPluginPlugin implements Plugin<TlsocPluginPluginSetup, TlsocPluginPluginStart> {
  private readonly logger: Logger;
  private readonly alertMailerService: AlertMailerService;
  private readonly config: TlsocPluginConfig;

  constructor(initializerContext: PluginInitializerContext<TlsocPluginConfig>) {
    this.logger = initializerContext.logger.get();
    this.alertMailerService = new AlertMailerService(this.logger.get('mailer'));
    this.config = initializerContext.config.get();
  }

  public setup(core: CoreSetup) {
    this.logger.debug('tlsoc_plugin: Setup');

    core.http.registerOnPreRouting((request, response, toolkit) => {
      const path = request.url.pathname;
      const search = request.url.search;

      if (path === '/app/tlsoc_plugin' || path.startsWith('/app/tlsoc_plugin/')) {
        const suffix = path.slice('/app/tlsoc_plugin'.length);
        return toolkit.rewriteUrl(`/app/tlsocPlugin${suffix}${search}`);
      }

      const spacePathMatch = path.match(/^\/s\/([^/]+)\/app\/tlsoc_plugin(\/.*)?$/);
      if (spacePathMatch) {
        const [, spaceId, suffix = ''] = spacePathMatch;
        return toolkit.rewriteUrl(`/s/${spaceId}/app/tlsocPlugin${suffix}${search}`);
      }

      return toolkit.next();
    });

    console.log('[tlsocPlugin] Setup called - creating router');
    const router = core.http.createRouter();
    console.log('[tlsocPlugin] Router created - defining routes');

    // Register server side APIs
    defineRoutes(router, this.logger, this.alertMailerService, this.config);
    console.log('[tlsocPlugin] Routes defined');

    return {};
  }

  public start(core: CoreStart) {
    this.logger.debug('tlsoc_plugin: Started');
    this.alertMailerService.start(core.elasticsearch.client.asInternalUser);

    const tryAutoActivate = () => {
      const status = this.alertMailerService.getStatus();
      if (!status.smtpConfigured || status.active) {
        return;
      }

      void this.alertMailerService.activate().then(() => {
        this.logger.info('[tlsocPlugin] Mailer auto-activated from persisted or environment configuration');
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`[tlsocPlugin] Mailer auto-activation failed: ${message}`);
      });
    };

    const smtpHost = process.env.TLSOC_SMTP_HOST;
    const smtpPortRaw = process.env.TLSOC_SMTP_PORT;
    const smtpUsername = process.env.TLSOC_SMTP_USERNAME;
    const smtpPassword = process.env.TLSOC_SMTP_PASSWORD;
    const smtpFrom = process.env.TLSOC_SMTP_FROM;

    if (smtpHost && smtpPortRaw && smtpUsername && smtpPassword && smtpFrom) {
      const smtpPort = Number(smtpPortRaw);
      if (Number.isFinite(smtpPort) && smtpPort > 0 && smtpPort <= 65535) {
        const smtpSecure = process.env.TLSOC_SMTP_SECURE === 'true';
        const adminEmail = process.env.TLSOC_ADMIN_EMAIL;
        const pollIntervalRaw = process.env.TLSOC_MAILER_POLL_SECONDS;
        const pollIntervalSeconds = pollIntervalRaw ? Number(pollIntervalRaw) : undefined;

        this.alertMailerService.configure({
          smtp: {
            host: smtpHost,
            port: smtpPort,
            secure: smtpSecure,
            username: smtpUsername,
            password: smtpPassword,
            from: smtpFrom,
          },
          adminEmail,
          pollIntervalSeconds:
            pollIntervalSeconds && Number.isFinite(pollIntervalSeconds) ? pollIntervalSeconds : undefined,
        });
        tryAutoActivate();
      } else {
        this.logger.warn('[tlsocPlugin] TLSOC_SMTP_PORT is invalid. Skipping mailer auto-configuration.');
      }
    }

    tryAutoActivate();

    return {};
  }

  public stop() {
    this.alertMailerService.stop();
  }
}
