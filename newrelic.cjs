'use strict';

exports.config = {
  app_name: [process.env.NEW_RELIC_APP_NAME ?? 'zip-code-lookup'],
  agent_enabled: Boolean(process.env.NEW_RELIC_LICENSE_KEY),
  logging: { level: 'info', filepath: 'stdout' },
};
