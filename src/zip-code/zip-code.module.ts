import { Module } from '@nestjs/common';
import { ZipCodeController } from './zip-code.controller.js';

@Module({
  controllers: [ZipCodeController],
})
export class ZipCodeModule {}
