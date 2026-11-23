import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module';
import { PaymentsModule } from '../payments/payments.module';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

@Module({
  imports: [CheckoutModule, PaymentsModule],
  controllers: [PosController],
  providers: [PosService],
})
export class PosModule {}
