import { PrismaClient, OutsourceOrderStatus } from "@prisma/client";
import { reconcileOutsourceOrderLineQuantities } from "../src/lib/outsource-material-stock-query";

const prisma = new PrismaClient();
const orderNoArg = process.argv[2];

async function main() {
  const where =
    orderNoArg != null && orderNoArg.length > 0
      ? { orderNo: orderNoArg }
      : { status: { in: [OutsourceOrderStatus.OPEN, OutsourceOrderStatus.CLOSED] } };

  const orders = await prisma.outsourceOrder.findMany({
    where,
    select: { id: true, orderNo: true },
    take: orderNoArg ? 1 : 5000,
  });

  let updated = 0;
  for (const o of orders) {
    const before = await prisma.outsourceOrderLine.findMany({
      where: { outsourceOrderId: o.id },
      select: { materialId: true, quantity: true },
    });
    await reconcileOutsourceOrderLineQuantities(prisma, o.id);
    const after = await prisma.outsourceOrderLine.findMany({
      where: { outsourceOrderId: o.id },
      select: { quantity: true },
    });
    const changed = before.some((b, i) => b.quantity !== after[i]?.quantity);
    if (changed) {
      updated += 1;
      console.log(`reconciled ${o.orderNo}`);
    }
  }
  console.log(`done: ${orders.length} orders checked, ${updated} updated`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });