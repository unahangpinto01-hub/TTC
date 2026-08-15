export const PAGE_SIZE = 20;

export function getPage(searchParams: { page?: string }) {
  const page = Math.max(1, Number(searchParams.page) || 1);
  return { page, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE };
}

export function pageCount(total: number) {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}
