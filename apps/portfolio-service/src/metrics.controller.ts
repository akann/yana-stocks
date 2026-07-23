import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { register } from './metrics';

@Controller('metrics')
export class MetricsController {
  @Get()
  async metrics(@Res() res: Response): Promise<void> {
    res.set('Content-Type', register.contentType);
    res.send(await register.metrics());
  }
}
