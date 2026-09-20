'use strict';

exports.config = {
  app_name: [process.env.NEW_RELIC_APP_NAME ?? 'zip-code-lookup'],
  agent_enabled: Boolean(process.env.NEW_RELIC_LICENSE_KEY),
  logging: { level: 'info', filepath: 'stdout' },
  // The client's own mistakes stay visible but out of the error rate; only a
  // request we failed to answer (503, 500) is an error.
  error_collector: { expected_status_codes: [400, 429] },
};
