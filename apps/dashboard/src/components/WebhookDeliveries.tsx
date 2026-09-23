import type { Delivery, Integration } from "@pyro/contracts";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const statusLabels: Record<Delivery["status"], string> = {
  pending: "Queued",
  delivering: "Sending",
  delivered: "Delivered",
  failed: "Failed",
};

interface WebhookDeliveriesProps {
  deliveries: Delivery[];
  webhooks: Integration[];
  busy: boolean;
  onRefresh: () => void;
  onRetry: (id: string) => void;
}

export function WebhookDeliveries({ deliveries, webhooks, busy, onRefresh, onRetry }: WebhookDeliveriesProps) {
  const webhookNames = new Map(webhooks.map((webhook) => [webhook.id, webhook.name]));
  const hasFailures = deliveries.some((delivery) => delivery.status === "failed");

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>Recent deliveries</CardTitle>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onRefresh}>
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {deliveries.length ? (
          <Table aria-label="Webhook delivery history" className="min-w-[720px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col" className="w-[32%] pl-5">Webhook</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col" className="text-right">Attempts</TableHead>
                <TableHead scope="col">Response</TableHead>
                <TableHead scope="col" className="pr-5">Created</TableHead>
                {hasFailures && <TableHead scope="col" className="pr-5 text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.map((delivery) => {
                const webhookName = webhookNames.get(delivery.integrationId);
                const createdAt = new Date(delivery.createdAt);
                const status = delivery.status === "pending" && delivery.attempts > 0 ? "Retry scheduled" : statusLabels[delivery.status];
                return (
                  <TableRow key={delivery.id} className="hover:bg-transparent">
                    <TableCell className="pl-5">
                      <div className={webhookName ? "font-medium" : "text-muted"}>{webhookName ?? "Deleted webhook"}</div>
                      <div className="mt-1 text-xs text-muted">{delivery.payload.type}</div>
                    </TableCell>
                    <TableCell>
                      <Badge className={delivery.status === "failed" ? "whitespace-nowrap border-danger/20 bg-danger/5 text-danger" : "whitespace-nowrap"}>{status}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{delivery.attempts}</TableCell>
                    <TableCell>
                      <div className="whitespace-nowrap tabular-nums">
                        {delivery.lastStatus !== undefined ? `HTTP ${delivery.lastStatus}` : delivery.status === "delivering" ? "In progress" : delivery.status === "pending" ? "Awaiting attempt" : "No response"}
                      </div>
                      {delivery.error && <p className="mt-1 max-w-64 break-words text-xs text-muted">{delivery.error}</p>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap pr-5">
                      <time dateTime={delivery.createdAt} title={createdAt.toLocaleString()}>
                        {createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                        <span className="mt-1 block text-xs text-muted">{createdAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
                      </time>
                    </TableCell>
                    {hasFailures && (
                      <TableCell className="pr-5 text-right">
                        {delivery.status === "failed" && <Button size="sm" variant="outline" disabled={busy} onClick={() => onRetry(delivery.id)}>Retry</Button>}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium">No deliveries yet</p>
            <p className="mt-1 text-xs text-muted">Send a test or wait for a matching decision.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
