import { Global, Module } from '@nestjs/common';
import { ExternalApiBreakersService } from './external-api-breakers.service';

@Global()
@Module({
  providers: [ExternalApiBreakersService],
  exports: [ExternalApiBreakersService],
})
export class CommonModule {}
