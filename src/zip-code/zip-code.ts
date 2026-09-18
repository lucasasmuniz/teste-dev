import { Param, StandardSchemaValidationPipe } from '@nestjs/common';
import { z } from 'zod';
import { MalformedZipCode } from '../problems.js';

const ACCEPTED_FORMATS = [
  /^\d{8}$/, // 01310930
  /^\d{5}-\d{3}$/, // 01310-930
  /^\d{2}\.\d{3}-\d{3}$/, // 01.310-930
  /^\d{5} \d{3}$/, // 01310 930
];

const zipCodeSchema = z
  .string()
  .refine(
    (value) => ACCEPTED_FORMATS.some((format) => format.test(value)),
    'The zip code must have 8 digits, optionally written as 01310-930, 01.310-930 or 01310 930.',
  )
  .transform((value) => value.replace(/\D/g, ''));

export function ZipCodeParam() {
  return Param('cep', {
    schema: zipCodeSchema,
    pipes: [
      new StandardSchemaValidationPipe({
        exceptionFactory: (issues) => new MalformedZipCode(issues[0].message),
      }),
    ],
  });
}
