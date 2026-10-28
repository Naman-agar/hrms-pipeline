// TPRD 01 §6.2 — shared pagination DTO.
//
// Query schema for list endpoints (03 §3, 04), the Prisma `skip`/`take` derivation and the
// `{ data, meta }` response helper. Query params arrive as strings, so both fields are coerced;
// `page_size` is restricted to the closed set 10|25|50|100 (a limit, not a suggestion).
//
// Usage in a service:
//   const { skip, take } = toSkipTake(query);
//   const [rows, total] = await this.prisma.$transaction([
//     this.prisma.user.findMany({ where, orderBy, skip, take, include }),
//     this.prisma.user.count({ where }),
//   ]);
//   return paginate(rows.map(toUserDto), total, query.page, query.page_size);

import { z } from 'zod';

/** Allowed `page_size` values (TPRD 01 §6.2). */
export const PAGE_SIZES = [10, 25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce
    .number()
    .int()
    .pipe(z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]))
    .default(25),
});

/** Parsed (output) shape — `page` and `page_size` are always present after defaults. */
export type PaginationQuery = z.infer<typeof PaginationSchema>;

/** Prisma offset/limit derived from a parsed query: `skip = (page-1)*page_size`, `take = page_size`. */
export const toSkipTake = ({
  page,
  page_size,
}: PaginationQuery): { skip: number; take: number } => ({
  skip: (page - 1) * page_size,
  take: page_size,
});

export interface PaginationMeta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

/** Wraps a page of rows in the `{ data, meta }` envelope; `total_pages` is never below 1. */
export const paginate = <T>(
  data: T[],
  total: number,
  page: number,
  page_size: number,
): Paginated<T> => ({
  data,
  meta: { page, page_size, total, total_pages: Math.ceil(total / page_size) || 1 },
});
