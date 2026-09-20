import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { pino } from 'pino';
import { AppModule } from './app.module.js';
import { CONFIG, InvalidConfig, type Config } from './config.js';
import { setupOpenApi } from './openapi.js';

// logger: false keeps Nest from printing unstructured lines before Pino exists.
const app = await NestFactory.create(AppModule, {
  logger: false,
  bufferLogs: true,
  abortOnError: false,
}).catch((err: unknown) => {
  if (err instanceof InvalidConfig) {
    pino().fatal({ issues: err.issues }, err.message);
  } else {
    pino().fatal({ err }, 'boot failed');
  }
  process.exit(1);
});
app.useLogger(app.get(Logger));
app.enableShutdownHooks();
setupOpenApi(app);
await app.listen(app.get<Config>(CONFIG).PORT);
