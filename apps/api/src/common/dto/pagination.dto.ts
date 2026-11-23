/**
 * Paginated envelope matching docs/api-guidelines.md:
 * { data: [...], meta: { page, limit, total, totalPages } }.
 *
 * Services return plain objects of this shape; controllers document it in
 * Swagger via @ApiOkResponse with getSchemaPath(ItemDto) (see audit.controller).
 */
export interface PaginatedEnvelope<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}
