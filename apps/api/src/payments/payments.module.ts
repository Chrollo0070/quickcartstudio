import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { MockPaymentProvider } from './mock-payment.provider';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RazorpayProvider } from './razorpay.provider';

@Module({
  imports: [OrdersModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, MockPaymentProvider, RazorpayProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
