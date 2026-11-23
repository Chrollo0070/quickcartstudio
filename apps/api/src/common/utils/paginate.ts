interface PageParams {
  page: number;
  limit: number;
}

/** Prisma skip/take for the standard pagination envelope. */
export function paginate({ page, limit }: PageParams): { skip: number; take: number } {
  return { skip: (page - 1) * limit, take: limit };
}
