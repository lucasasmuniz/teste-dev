import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type ReferenceObject,
  type SchemaObject,
} from '@nestjs/swagger';
import assert from 'node:assert';
import { z } from 'zod';

// Every zod schema carrying `.meta({ id })` becomes a component, wherever it
// is declared.
export function setupOpenApi(app: INestApplication) {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Zip code lookup')
      .setDescription(
        'Resolves a CEP into one canonical address, whichever provider answered.',
      )
      .setVersion('1.0')
      .build(),
  );
  document.components = {
    ...document.components,
    schemas: { ...document.components?.schemas, ...registeredSchemas() },
  };
  SwaggerModule.setup('docs', app, document);
}

export function schemaRef(schema: z.ZodType): ReferenceObject {
  const id = z.globalRegistry.get(schema)?.id;
  assert(id, 'schema has no id in the zod global registry');
  return { $ref: componentRef(id) };
}

function registeredSchemas(): Record<string, SchemaObject> {
  const { schemas } = z.toJSONSchema(z.globalRegistry, {
    target: 'openapi-3.0',
    uri: componentRef,
  });
  // OpenAPI 3.0 has no $id; the component name already identifies it.
  for (const schema of Object.values(schemas)) {
    delete schema.$id;
  }
  return schemas as Record<string, SchemaObject>;
}

function componentRef(id: string): string {
  return `#/components/schemas/${id}`;
}
