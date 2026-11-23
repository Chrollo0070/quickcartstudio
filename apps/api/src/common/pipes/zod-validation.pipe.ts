import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { flattenError, type ZodType } from 'zod';

/**
 * Input validation with Zod (see docs/decisions/ADR-002-zod-for-validation.md).
 * Attach per-route to bodies, queries and params that have a declared schema:
 *
 *   @Post('scan')
 *   @UsePipes(new ZodValidationPipe(scanSchema))
 *   scan(@Body() body: ScanInput) { ... }
 *
 * Validation errors never leak internal details; they return a stable
 * `fieldErrors`/`formErrors` envelope so the frontend can render messages.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const flattened = flattenError(result.error);
      throw new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        error: 'Bad Request',
        fieldErrors: flattened.fieldErrors,
        formErrors: flattened.formErrors,
      });
    }
    return result.data;
  }
}
