import { Module } from '@nestjs/common';
import { CatalogueController, ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [ProductsController, CatalogueController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class CatalogueModule {}
