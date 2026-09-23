import * as React from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <div className="w-full overflow-auto"><table className={cn("ui-table w-full caption-bottom text-[13px]", className)} {...props} /></div>;
}
export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) { return <thead className={cn("border-b border-line bg-surface-subtle", className)} {...props} />; }
export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) { return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />; }
export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) { return <tr className={cn("border-b border-line transition-colors hover:bg-surface-subtle/70", className)} {...props} />; }
export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) { return <th className={cn("h-10 px-4 text-left text-xs font-medium text-muted", className)} {...props} />; }
export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) { return <td className={cn("px-4 py-3.5 align-middle", className)} {...props} />; }
