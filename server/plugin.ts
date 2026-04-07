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

export class TlsocPluginPlugin implements Plugin<TlsocPluginPluginSetup, TlsocPluginPluginStart> {
  private readonly logger: Logger;
  private readonly config: TlsocPluginConfig;

  constructor(initializerContext: PluginInitializerContext) {
    this.logger = initializerContext.logger.get();
    this.config = initializerContext.config.get<TlsocPluginConfig>();
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
    defineRoutes(router, this.logger, this.config);
    console.log('[tlsocPlugin] Routes defined');

    return {};
  }

  public start(core: CoreStart) {
    this.logger.debug('tlsoc_plugin: Started');
    return {};
  }

  public stop() {}
}
