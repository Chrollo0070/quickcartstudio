import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { CheckoutSessionGuard } from './checkout.guard';
import { ReservationReaperService } from './reservation-reaper.service';

@Module({
  imports: [PricingModule],
  controllers: [CheckoutController],
  providers: [CheckoutService, CheckoutSessionGuard, ReservationReaperService],
  exports: [CheckoutService, ReservationReaperService],
})
export class CheckoutModule {}
