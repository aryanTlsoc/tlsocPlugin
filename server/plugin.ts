import {
  PluginInitializerContext,
  CoreSetup,
  CoreStart,
  Plugin,
  Logger,
} from '../../../src/core/server';

import { TlsocPluginPluginSetup, TlsocPluginPluginStart } from './types';
import { defineRoutes } from './routes';

export class TlsocPluginPlugin implements Plugin<TlsocPluginPluginSetup, TlsocPluginPluginStart> {
  private readonly logger: Logger;

  constructor(initializerContext: PluginInitializerContext) {
    this.logger = initializerContext.logger.get();
  }

  public setup(core: CoreSetup) {
    this.logger.debug('tlsoc_plugin: Setup');
    const router = core.http.createRouter();

    // Register server side APIs
    defineRoutes(router);

    return {};
  }

  public start(core: CoreStart) {
    this.logger.debug('tlsoc_plugin: Started');
    return {};
  }

  public stop() {}
}
